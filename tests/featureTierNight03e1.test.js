/**
 * FEATURE-TIERNIGHT-03-E1 — audit consolidation : mutations, rollbacks, autorité, Rank Live.
 */
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  setTierNightSeriesUiEnabledForTests,
  TIER_NIGHT_SERIES_UI_GATE_KEY,
  isTierNightSeriesUiEnabled,
} from "../js/core/tierNightSeriesGate.js";
import {
  mergeConsumedCustomRosterTopicIdsForHydrate,
  mergeTierNightPrepRemoteState,
  resolveTierNightRosterDestinationFromSharedState,
} from "../js/core/tierNightSeriesPrepContracts.js";
import { mergeTierNightRemoteBlob as mergeTnBlob } from "../js/core/tierNightSeries.js";
import { snapshotStatePatch } from "../js/core/restartGameRollback.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), unsubscribe: () => {} }),
    },
  },
});

const {
  buildClearedTierNightSeriesRemote,
  buildSeriesExitLocalStatePatch,
  buildSeriesExitRemoteMutation,
  buildSeriesExitPrepReset,
  resolveChangeModeDestination,
  resolveReplayDestination,
  shouldReplayTierNightSeriesToPrep,
  canAuthorSeriesExit,
  canAuthorSeriesQuit,
  __testGetSeriesExitNavLock,
} = await import("../js/core/tierNightSeriesExitNav.js");
const { resolveTierNightSeriesScreenFromPhase } = await import(
  "../js/core/tierNightSeriesPlaySession.js"
);
const { getState, saveStatePatch } = await import("../js/core/state.js");
const { getEffectiveSessionScreen } = await import("../js/core/gameSync.js");
const { markTierNightClassicStarted } = await import("../js/core/tierNightLiveSession.js");
const {
  initRouter,
  registerScreen,
  resetNav,
} = await import("../js/core/router.js");

function fakeApp() {
  return {
    innerHTML: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function seedSeriesEndState() {
  saveStatePatch({
    consumedCustomRosterTopicIds: ["roster:custom-used"],
    customRosterTopics: [{ id: "roster:custom-free", name: "Free" }],
    customTierLists: [{ id: "live-list-1", name: "Live A", items: ["x"] }],
    tierNightMode: "roster",
    tierNightSeriesPrep: {
      categoryIds: ["fun"],
      roundCount: 3,
      ready: { "uid-a": true },
      setupEpoch: 4,
    },
    tierNightGame: {
      runId: "run-series-1",
      lobbyStarted: true,
      mode: "roster",
      series: {
        phase: "series_end",
        roundIndex: 2,
        queue: [
          { roundId: "run-series-1:0", topicId: "roster:a" },
          { roundId: "run-series-1:1", topicId: "roster:b" },
          { roundId: "run-series-1:2", topicId: "roster:c" },
        ],
      },
      recaps: [{ player: "Alice", placed: { S: ["Bob"] } }],
    },
    tierNightLiveGame: {
      runId: "live-run-keep",
      lobbyStarted: false,
      finished: true,
      topicId: "live-list-1",
      listName: "Live A",
      votes: { alice: 1 },
      phase: "done",
    },
  });
}

describe("FEATURE-TIERNIGHT-03-E1 - payloads atomiques", () => {
  it("1. change mode = une mutation logique (tierNight + prep + screen, pas live/consumed)", () => {
    const dest = resolveChangeModeDestination();
    const remote = buildSeriesExitRemoteMutation({
      previousSetupEpoch: 4,
      screen: dest.screen,
    });
    assert.equal(dest.screen, "tiernight-select");
    assert.deepEqual(Object.keys(remote.stateMerge).sort(), [
      "tierNight",
      "tierNightPrep",
    ]);
    assert.equal(remote.stateMerge.tierNight.series, null);
    assert.equal(remote.stateMerge.tierNight.runId, null);
    assert.equal(remote.stateMerge.tierNight.lobbyStarted, false);
    assert.equal(remote.stateMerge.tierNight.items, null);
    assert.equal(remote.stateMerge.tierNight.playerRoster, null);
    assert.equal(remote.stateMerge.tierNight.recap, null);
    assert.deepEqual(remote.stateMerge.tierNightPrep.ready, {});
    assert.equal(remote.stateMerge.tierNightPrep.setupEpoch, 5);
    assert.equal(remote.patchOpts.screen, "tiernight-select");
    assert.equal(remote.patchOpts.gameId, "tiernight");
    assert.equal("tierNightLive" in remote.stateMerge, false);
    assert.equal("consumedCustomRosterTopicIds" in remote.stateMerge, false);
    assert.equal("customRosterTopics" in remote.stateMerge, false);

    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /await patchGameState\(remote\.stateMerge/);
    assert.equal((exit.match(/patchGameState\(/g) || []).length, 1);
  });

  it("2. rollback change mode restaure série, prep ; customs/consumed hors patch", () => {
    seedSeriesEndState();
    const before = getState();
    const { statePatch } = buildSeriesExitLocalStatePatch({
      previousSetupEpoch: before.tierNightSeriesPrep.setupEpoch,
    });
    const snap = snapshotStatePatch(before, Object.keys(statePatch));
    saveStatePatch(statePatch);

    assert.equal(getState().tierNightGame.series, undefined);
    assert.equal(getState().tierNightGame.runId, null);
    assert.deepEqual(getState().tierNightSeriesPrep.ready, {});

    saveStatePatch(snap);
    assert.equal(getState().tierNightGame.series.phase, "series_end");
    assert.equal(getState().tierNightGame.runId, "run-series-1");
    assert.equal(getState().tierNightSeriesPrep.setupEpoch, 4);
    assert.equal(getState().tierNightSeriesPrep.ready["uid-a"], true);
    assert.deepEqual(getState().consumedCustomRosterTopicIds, ["roster:custom-used"]);
    assert.equal(getState().customRosterTopics[0].id, "roster:custom-free");
    assert.equal(getState().customTierLists[0].id, "live-list-1");
  });

  it("3. timeout change mode réconciliable (refresh avant rollback)", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /refreshGameSession/);
    assert.match(exit, /reconciled:\s*true/);
    assert.match(exit, /rolledBack:\s*true/);
  });
});

describe("FEATURE-TIERNIGHT-03-E1 - replay", () => {
  beforeEach(() => {
    setTierNightSeriesUiEnabledForTests(true);
    seedSeriesEndState();
  });
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("4. replay ne crée ni queue ni runId", () => {
    const dest = resolveReplayDestination({ seriesUiEnabled: true });
    assert.equal(dest.screen, "tiernight-prep");
    const local = buildSeriesExitLocalStatePatch({ previousSetupEpoch: 4 });
    assert.equal(local.statePatch.tierNightGame.runId, null);
    assert.equal(local.statePatch.tierNightGame.series, undefined);
    assert.doesNotMatch(JSON.stringify(local.statePatch), /"queue"/);

    const remote = buildSeriesExitRemoteMutation({
      previousSetupEpoch: 4,
      screen: dest.screen,
    });
    assert.equal(remote.stateMerge.tierNight.runId, null);
    assert.equal(remote.stateMerge.tierNight.series, null);
    assert.doesNotMatch(JSON.stringify(remote.stateMerge), /"queue"/);
  });

  it("5. rollback replay restaure series_end", () => {
    const before = getState();
    const { statePatch } = buildSeriesExitLocalStatePatch({
      previousSetupEpoch: 4,
    });
    const snap = snapshotStatePatch(before, Object.keys(statePatch));
    saveStatePatch(statePatch);
    assert.notEqual(getState().tierNightGame?.series?.phase, "series_end");
    saveStatePatch(snap);
    assert.equal(getState().tierNightGame.series.phase, "series_end");
    assert.equal(getState().tierNightGame.series.queue.length, 3);
  });

  it("6. replay reload reste au prep sans queue (destination + clear)", () => {
    const dest = resolveReplayDestination({ seriesUiEnabled: true });
    assert.equal(dest.screen, "tiernight-prep");
    saveStatePatch(buildSeriesExitLocalStatePatch({ previousSetupEpoch: 4 }).statePatch);
    assert.equal(getState().tierNightGame?.series, undefined);
    assert.equal(getState().tierNightGame?.runId, null);
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: getState().tierNightGame,
      hasTierNightPrep: true,
      seriesUiEnabled: true,
    });
    assert.equal(r.screen, "tiernight-prep");
  });

  it("19. legacy replay ouvre prep sans création de queue", () => {
    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: true,
        tierNight: {
          mode: "roster",
          lobbyStarted: false,
          recaps: [{ player: "A", placed: { S: ["B"] } }],
        },
        tierNightMode: "roster",
      }),
      true
    );
    const local = buildSeriesExitLocalStatePatch({ previousSetupEpoch: 1 });
    assert.equal(local.statePatch.tierNightGame.runId, null);
    assert.doesNotMatch(JSON.stringify(local.statePatch.tierNightGame), /queue/);
  });
});

describe("FEATURE-TIERNIGHT-03-E1 - quit", () => {
  it("7. quit clear série sessions sans clear customs/consumed (resetGameSessionsOnly)", () => {
    const stateSrc = read("js/core/state.js");
    const fn = stateSrc.match(
      /export function resetGameSessionsOnly\([\s\S]*?^\}/m
    )?.[0];
    assert.ok(fn);
    assert.match(fn, /tierNightGame/);
    assert.match(fn, /tierNightSeriesPrep/);
    assert.doesNotMatch(fn, /consumedCustomRosterTopicIds/);
    assert.doesNotMatch(fn, /customRosterTopics/);
    assert.doesNotMatch(fn, /customTierLists/);

    const exit = read("js/core/exitGame.js");
    assert.match(exit, /returnToGameSelect/);
    assert.match(exit, /resetGameSessionsOnly/);
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /export async function returnToGameSelect/);
    assert.match(sync, /endGameSession/);
    assert.match(sync, /deleteGameSession/);
  });

  it("8. quit rollback : pas de apply local avant confirm ; delete échoue → local intact", () => {
    const exit = read("js/core/exitGame.js");
    const body = exit.match(
      /export async function exitGameToGameSelect\([\s\S]*?^\}/m
    )?.[0];
    assert.ok(body);
    const confirmIdx = body.indexOf("showAppConfirm");
    const resetIdx = body.indexOf("resetGameSessionsOnly");
    const returnIdx = body.indexOf("returnToGameSelect");
    assert.ok(confirmIdx > 0 && confirmIdx < returnIdx);
    assert.ok(confirmIdx < resetIdx || resetIdx < 0 || returnIdx < resetIdx);
  });
});

describe("FEATURE-TIERNIGHT-03-E1 - autorité / stale / consumed / ready", () => {
  it("9. invité : handlers protégés + mutation NOT_HOST", () => {
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /onNextTheme[\s\S]*isLobbyHost\(\) \|\| canActAsHost\(\)/);
    assert.match(between, /onChangeMode[\s\S]*isLobbyHost\(\) \|\| canActAsHost\(\)/);
    assert.match(between, /onQuit[\s\S]*!isLobbyHost\(\)\) return/);
    const end = read("js/screens/tierNightEnd.js");
    assert.match(end, /onQuit[\s\S]*!isLobbyHost\(\)\) return/);
    assert.equal(typeof canAuthorSeriesExit, "function");
    assert.equal(typeof canAuthorSeriesQuit, "function");
  });

  it("10. acting host : change/replay/next oui ; quit non", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /canAuthorSeriesExit[\s\S]*canActAsHost/);
    assert.match(exit, /canAuthorSeriesQuit[\s\S]*isLobbyHost\(\)/);
    assert.doesNotMatch(
      exit.match(/export function canAuthorSeriesQuit[\s\S]*?^\}/m)?.[0] || "",
      /canActAsHost/
    );
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /canHostSeriesCommit[\s\S]*canActAsHost/);
  });

  it("11. callback stale n’écrase pas un état plus récent (pas de rollback après succès)", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    const staleBlock = exit.match(/code: "STALE"[\s\S]*?networkCalls: 1/);
    assert.ok(staleBlock);
    assert.doesNotMatch(staleBlock[0], /saveStatePatch\(previousPatch\)/);
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /TNS_STALE_CALLBACK/);
  });

  it("12. consumed distant stale [] ne shrink pas", () => {
    const merged = mergeConsumedCustomRosterTopicIdsForHydrate(
      ["roster:a", "roster:b"],
      []
    );
    assert.deepEqual(merged, ["roster:a", "roster:b"]);
    const omitted = mergeConsumedCustomRosterTopicIdsForHydrate(
      ["roster:a"],
      undefined
    );
    assert.deepEqual(omitted, ["roster:a"]);
  });

  it("13. ready stale d’un ancien epoch ne ressuscite pas", () => {
    const cur = {
      setupEpoch: 5,
      ready: {},
      categoryIds: ["*"],
      roundCount: 5,
    };
    const stale = {
      setupEpoch: 4,
      ready: { "uid-old": true },
      categoryIds: ["fun"],
      roundCount: 3,
    };
    const next = mergeTierNightPrepRemoteState(cur, stale);
    assert.equal(next.setupEpoch, 5);
    assert.deepEqual(next.ready, {});
    assert.deepEqual(next.categoryIds, ["*"]);

    const bump = buildSeriesExitPrepReset(4);
    const afterBump = mergeTierNightPrepRemoteState(
      { setupEpoch: 4, ready: { "uid-a": true }, categoryIds: ["fun"], roundCount: 3 },
      {
        setupEpoch: bump.setupEpoch,
        ready: bump.ready,
        categoryIds: bump.categoryIds,
        roundCount: bump.roundCount,
      }
    );
    assert.equal(afterBump.setupEpoch, 5);
    assert.deepEqual(afterBump.ready, {});
  });
});

describe("FEATURE-TIERNIGHT-03-E1 - shapes invalides / routeur", () => {
  beforeEach(() => {
    initRouter(fakeApp());
    for (const id of [
      "home",
      "lobby",
      "game-select",
      "tiernight-select",
      "tiernight-prep",
      "tiernight",
      "tiernight-between",
      "tiernight-end",
    ]) {
      registerScreen(id, () => null);
    }
    setTierNightSeriesUiEnabledForTests(true);
  });
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    resetNav();
  });

  it("14. shape invalide ne laisse pas l’ancien board jouable (effective screen)", () => {
    assert.equal(resolveTierNightSeriesScreenFromPhase("nope"), null);
    const eff = getEffectiveSessionScreen({
      screen: "tiernight-between",
      game_id: "tiernight",
      state: {
        tierNight: {
          lobbyStarted: true,
          series: { phase: "bogus_phase", queue: [{}] },
        },
      },
    });
    assert.equal(eff, "tiernight-prep");
    assert.notEqual(eff, "tiernight-between");
    assert.notEqual(eff, "tiernight");
  });

  it("15. round_result ne laisse pas between avec CTA", () => {
    assert.equal(resolveTierNightSeriesScreenFromPhase("round_result"), null);
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /phase === "round_result"/);
    assert.match(between, /navigate\("tiernight-prep"\)/);
    const eff = getEffectiveSessionScreen({
      screen: "tiernight-between",
      game_id: "tiernight",
      state: {
        tierNight: {
          lobbyStarted: true,
          series: { phase: "round_result", queue: [{}] },
        },
      },
    });
    assert.equal(eff, "tiernight-prep");
  });
});

describe("FEATURE-TIERNIGHT-03-E1 - Rank Live isolation", () => {
  beforeEach(() => {
    seedSeriesEndState();
  });

  it("16–17. Rank Live / customTierLists intacts après sortie roster", () => {
    const beforeLive = structuredClone(getState().tierNightLiveGame);
    const beforeLists = structuredClone(getState().customTierLists);
    const { statePatch } = buildSeriesExitLocalStatePatch({ previousSetupEpoch: 4 });
    assert.equal("tierNightLiveGame" in statePatch, false);
    assert.equal("customTierLists" in statePatch, false);
    saveStatePatch(statePatch);
    assert.deepEqual(getState().tierNightLiveGame, beforeLive);
    assert.deepEqual(getState().customTierLists, beforeLists);
    assert.equal(getState().tierNightLiveGame.runId, "live-run-keep");
    assert.equal(getState().tierNightLiveGame.votes.alice, 1);

    const remote = buildSeriesExitRemoteMutation({
      previousSetupEpoch: 4,
      screen: "tiernight-select",
    });
    assert.equal("tierNightLive" in remote.stateMerge, false);

    // Merge remote clear n’ampute pas un live absent du patch
    const merged = mergeTnBlob(
      {
        runId: "run-series-1",
        lobbyStarted: true,
        series: { phase: "series_end", queue: [{}] },
      },
      remote.stateMerge.tierNight,
      { source: "patch" }
    );
    assert.equal(merged.tierNight.series, undefined);
    assert.equal(merged.decision.action, "clear");
  });

  it("18. aucun markTierNightClassicStarted sous gate ON", async () => {
    setTierNightSeriesUiEnabledForTests(true);
    const res = await markTierNightClassicStarted({
      topicId: "roster:who-drinks",
      mode: "roster",
      modifier: "normal",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "SERIES_GATE_BLOCKS_CLASSIC");
    setTierNightSeriesUiEnabledForTests(false);
  });
});

describe("FEATURE-TIERNIGHT-03-E1 - void / réseau / merge clear", () => {
  it("20. aucune promesse critique ignorée via void sur change/replay", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.doesNotMatch(exit, /void\s+patchGameState/);
    assert.doesNotMatch(exit, /void\s+changeTierNight/);
    assert.doesNotMatch(exit, /void\s+replayTierNight/);
    const between = read("js/screens/tierNightBetween.js");
    assert.doesNotMatch(between, /void\s+changeTierNightModeFromSeriesPlay/);
    assert.doesNotMatch(between, /void\s+hostAdvance/);
    const end = read("js/screens/tierNightEnd.js");
    assert.doesNotMatch(end, /void\s+changeTierNightModeFromSeriesPlay/);
  });

  it("clear series:null est bien clear canonique du codec", () => {
    const { tierNight, decision } = mergeTnBlob(
      {
        runId: "r1",
        series: { phase: "between_rounds", queue: [{ roundId: "r1:0" }] },
      },
      buildClearedTierNightSeriesRemote(),
      { source: "patch" }
    );
    assert.equal(decision.action, "clear");
    assert.equal(tierNight.series, undefined);
    assert.equal(tierNight.runId, null);
    assert.equal(tierNight.lobbyStarted, false);
  });

  it("anti-double exitNavLock", async () => {
    const lock = __testGetSeriesExitNavLock();
    assert.equal(typeof lock.run, "function");
    let release;
    const hold = new Promise((r) => {
      release = r;
    });
    const first = lock.run(async () => {
      await hold;
      return "a";
    });
    const second = await lock.run(async () => "b");
    assert.equal(second.ok, false);
    assert.equal(second.skipped, true);
    release();
    const done = await first;
    assert.equal(done.ok, true);
    assert.equal(done.value, "a");
  });

  it("série activée par défaut (F)", () => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});
