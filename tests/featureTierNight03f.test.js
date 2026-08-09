/**
 * FEATURE-TIERNIGHT-03-F — activation finale parcours série, retrait classic/wizard.
 */
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTierNightSeriesUiEnabled,
  setTierNightSeriesUiEnabledForTests,
  TIER_NIGHT_SERIES_UI_GATE_KEY,
} from "../js/core/tierNightSeriesGate.js";
import {
  resolveTierNightRosterDestinationFromSharedState,
  mergeConsumedCustomRosterTopicIdsForHydrate,
} from "../js/core/tierNightSeriesPrepContracts.js";
import { prepareTierNightSeriesLaunchAttempt } from "../js/core/tierNightSeriesLaunch.js";
import { TIER_NIGHT_SERIES_ALL_CATEGORIES, TIER_NIGHT_SERIES_ROUND_COUNTS } from "../js/core/tierNightSeries.js";

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
  buildSeriesExitLocalStatePatch,
  buildSeriesExitRemoteMutation,
  shouldReplayTierNightSeriesToPrep,
  canAuthorSeriesQuit,
} = await import("../js/core/tierNightSeriesExitNav.js");
const { resolveTierNightSeriesScreenFromPhase } = await import(
  "../js/core/tierNightSeriesPlaySession.js"
);
const { getState, saveStatePatch } = await import("../js/core/state.js");
const { markTierNightClassicStarted } = await import("../js/core/tierNightLiveSession.js");
const { getEffectiveSessionScreen } = await import("../js/core/gameSync.js");
const { returnToTierNightSelectStep } = await import("../js/core/tierNightNav.js");
const {
  initRouter,
  navigate,
  getCurrentScreen,
  registerScreen,
  resetNav,
} = await import("../js/core/router.js");

const PARTICIPANTS = [
  { userId: "11111111-1111-4111-8111-111111111111", name: "Alice", emoji: "🙂" },
  { userId: "22222222-2222-4222-8222-222222222222", name: "Bob", emoji: "😎" },
];

function fakeApp() {
  return { innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; } };
}

describe("FEATURE-TIERNIGHT-03-F - parcours produit", () => {
  afterEach(() => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("1. parcours roster définitif sans gate OFF classic", () => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    assert.equal(isTierNightSeriesUiEnabled(), true);
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /openSeriesPrepFromRoster/);
    assert.doesNotMatch(select, /topicStepHtml/);
    assert.doesNotMatch(select, /markTierNightClassicStarted/);
  });

  it("2–3. aucune création classic / aucun appel produit markClassic", async () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.doesNotMatch(select, /markTierNightClassicStarted/);
    assert.doesNotMatch(select, /startGame\(/);
    const res = await markTierNightClassicStarted({
      topicId: "roster:who-drinks",
      mode: "roster",
      modifier: "normal",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "SERIES_GATE_BLOCKS_CLASSIC");
  });

  it("4–5. ancien écran grille / wizard normalisé", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /LEGACY_SERIES_DEAD_STEPS/);
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: { lobbyStarted: false },
      seriesUiEnabled: true,
      declaredScreen: "tiernight-select",
    });
    assert.equal(r.screen, "tiernight-prep");
  });

  it("6–8. série active / classic actif / classic replay", () => {
    assert.equal(
      resolveTierNightRosterDestinationFromSharedState({
        tierNight: {
          lobbyStarted: true,
          series: { phase: "between_rounds", queue: [{}, {}] },
        },
        seriesUiEnabled: false,
      }).screen,
      "tiernight-between"
    );
    assert.equal(
      resolveTierNightRosterDestinationFromSharedState({
        tierNight: { lobbyStarted: true, items: ["A"] },
        seriesUiEnabled: true,
      }).reason,
      "legacy_active"
    );
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
  });
});

describe("FEATURE-TIERNIGHT-03-F - prep / launch / replay", () => {
  it("9–11. prep sans queue ; launch crée ; replay ne crée pas", () => {
    const prep = read("js/screens/tierNightPrep.js");
    assert.match(prep, /Queue uniquement au launch/);
    const attempt = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      participants: PARTICIPANTS,
      rng: () => 0.2,
    });
    assert.equal(attempt.ok, true);
    assert.ok(attempt.attempt.runId);
    assert.equal(attempt.attempt.series.queue.length, 3);

    const exit = buildSeriesExitLocalStatePatch({ previousSetupEpoch: 2 });
    assert.equal(exit.statePatch.tierNightGame.runId, null);
    assert.doesNotMatch(JSON.stringify(exit.statePatch), /"queue"/);
  });

  it("12. change mode clear série, preserve live/customs/consumed", () => {
    saveStatePatch({
      consumedCustomRosterTopicIds: ["roster:c1"],
      customRosterTopics: [{ id: "roster:c2" }],
      customTierLists: [{ id: "live-1", name: "L", items: ["x"] }],
      tierNightLiveGame: { runId: "keep-live", votes: { a: 1 }, lobbyStarted: false },
      tierNightSeriesPrep: { setupEpoch: 3, ready: { u: true }, categoryIds: ["*"], roundCount: 5 },
    });
    const before = {
      consumed: [...getState().consumedCustomRosterTopicIds],
      lists: structuredClone(getState().customTierLists),
      live: structuredClone(getState().tierNightLiveGame),
    };
    const { statePatch } = buildSeriesExitLocalStatePatch({ previousSetupEpoch: 3 });
    saveStatePatch(statePatch);
    assert.equal(getState().tierNightGame.runId, null);
    assert.deepEqual(getState().consumedCustomRosterTopicIds, before.consumed);
    assert.deepEqual(getState().customTierLists, before.lists);
    assert.deepEqual(getState().tierNightLiveGame, before.live);
    const remote = buildSeriesExitRemoteMutation({
      previousSetupEpoch: 3,
      screen: "tiernight-select",
    });
    assert.equal("tierNightLive" in remote.stateMerge, false);
    assert.equal("consumedCustomRosterTopicIds" in remote.stateMerge, false);
  });
});

describe("FEATURE-TIERNIGHT-03-F - quit", () => {
  it("13–19. quit host-only + delete reconcile + preserve", () => {
    const between = read("js/screens/tierNightBetween.js");
    const end = read("js/screens/tierNightEnd.js");
    assert.match(between, /realHost/);
    assert.match(between, /!isLobbyHost\(\)\) return/);
    assert.match(end, /!isLobbyHost\(\)\) return/);
    assert.match(between, /shouldContinue/);
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /canAuthorSeriesQuit/);
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /withPatchTimeout/);
    assert.match(sync, /Fermeture de partie trop longue/);
    assert.match(sync, /fetchGameSessionByLobby/);
    assert.match(sync, /resetLocalGamePrepState\(\);\s*\n\s*if \(!canContinue\(\)\) return true/);
    const stateSrc = read("js/core/state.js");
    const reset = stateSrc.match(/export function resetGameSessionsOnly\([\s\S]*?^\}/m)?.[0];
    assert.ok(reset);
    assert.doesNotMatch(reset, /consumedCustomRosterTopicIds/);
    assert.doesNotMatch(reset, /customTierLists/);
    assert.equal(typeof canAuthorSeriesQuit, "function");
  });
});

describe("FEATURE-TIERNIGHT-03-F - shapes / Rank Live / consumed", () => {
  beforeEach(() => {
    initRouter(fakeApp());
    for (const id of [
      "home",
      "lobby",
      "game-select",
      "tiernight-select",
      "tiernight-prep",
      "tiernight-between",
    ]) {
      registerScreen(id, () => null);
    }
  });
  afterEach(() => resetNav());

  it("20–22. round_result / invalide / declared stale", () => {
    assert.equal(resolveTierNightSeriesScreenFromPhase("round_result"), null);
    const eff = getEffectiveSessionScreen({
      screen: "tiernight-between",
      game_id: "tiernight",
      state: {
        tierNight: { lobbyStarted: true, series: { phase: "round_result", queue: [{}] } },
      },
    });
    assert.equal(eff, "tiernight-prep");
    const stale = resolveTierNightRosterDestinationFromSharedState({
      tierNight: {
        lobbyStarted: false,
        series: { phase: "ranking", queue: [{}] },
      },
      seriesUiEnabled: true,
      declaredScreen: "tiernight-select",
    });
    assert.equal(stale.screen, "tiernight");
  });

  it("23–27. Rank Live isolé + customTierLists (04D : prep, pas step=list)", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /enterTierNightLivePrep/);
    assert.match(select, /id === "live"/);
    // Legacy mono peut rester en source (startLiveGame) mais n'est plus bindé depuis le parcours.
    assert.doesNotMatch(select, /bindTierGrid\(app,\s*\(id\)\s*=>\s*startLiveGame/);
    assert.doesNotMatch(select, /topicStepHtml/);
    const create = read("js/screens/tierNightCreate.js");
    assert.match(create, /from === "live-prep"|from:\s*"live-prep"/);
    assert.match(create, /step:\s*"mode"/);
    saveStatePatch({
      customTierLists: [{ id: "keep", name: "K", items: ["a"] }],
    });
    saveStatePatch(buildSeriesExitLocalStatePatch({ previousSetupEpoch: 1 }).statePatch);
    assert.equal(getState().customTierLists[0].id, "keep");
  });

  it("28–30. consumed monotone + exclusion", () => {
    assert.deepEqual(
      mergeConsumedCustomRosterTopicIdsForHydrate(["a", "b"], []),
      ["a", "b"]
    );
    const attempt = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      participants: PARTICIPANTS,
      customTopics: [
        { id: "roster:used", name: "U", emoji: "x", items: ["Alice", "Bob"] },
        { id: "roster:free", name: "F", emoji: "y", items: ["Alice", "Bob"] },
      ],
      excludeCustomIds: ["roster:used"],
      rng: () => 0,
    });
    assert.equal(attempt.ok, true);
    assert.equal(
      attempt.attempt.series.queue.some((q) => q.topicId === "roster:used"),
      false
    );
  });

  it("31–32. count 7 non proposé ; legacy lisible via validate", () => {
    assert.deepEqual([...TIER_NIGHT_SERIES_ROUND_COUNTS], [3, 5, 8]);
    assert.equal(TIER_NIGHT_SERIES_ROUND_COUNTS.includes(7), false);
  });
});

describe("FEATURE-TIERNIGHT-03-F - DOM mort / void / double push / hydrate", () => {
  it("33–35. pas de route wizard DOM / CSS roster morte", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.doesNotMatch(select, /data-roster-path/);
    assert.doesNotMatch(select, /data-roster="/);
    assert.doesNotMatch(select, /data-series-category|seriesCategoryStepHtml/);
    const css = read("style.css");
    assert.doesNotMatch(css, /\.tier-roster-card\{/);
    assert.match(css, /FEATURE-TIERNIGHT-03-F/);
  });

  it("36–37. aucun void critique change/replay ; un seul patchGameState exit", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.doesNotMatch(exit, /void\s+patchGameState/);
    assert.equal((exit.match(/await patchGameState\(/g) || []).length, 1);
  });

  it("38–40. hydrate ne reshuffle ; fin soirée seule clear consumed", () => {
    const sync = read("js/core/gameSync.js");
    assert.doesNotMatch(sync, /buildTierNightSeriesQueue/);
    assert.doesNotMatch(sync, /prepareTierNightSeriesLaunchAttempt/);
    const state = read("js/core/state.js");
    assert.match(state, /resetEveningState/);
    const evening = state.match(/export function resetEveningState[\s\S]*?^\}/m)?.[0] || "";
    assert.match(evening, /consumedCustomRosterTopicIds/);
    const sessionsOnly = state.match(/export function resetGameSessionsOnly[\s\S]*?^\}/m)?.[0] || "";
    assert.doesNotMatch(sessionsOnly, /consumedCustomRosterTopicIds/);
  });

  it("kill switch OFF n’ouvre pas classic", () => {
    setTierNightSeriesUiEnabledForTests(false);
    assert.equal(isTierNightSeriesUiEnabled(), false);
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /temporairement indisponible/);
    assert.doesNotMatch(select, /markTierNightClassicStarted/);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("create-roster → prep (nav F)", () => {
    globalThis.requestAnimationFrame = (fn) => {
      fn();
      return 1;
    };
    initRouter(fakeApp());
    for (const id of ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep", "tiernight-create-roster"]) {
      registerScreen(id, () => null);
    }
    navigate("home", { reset: true });
    navigate("tiernight-create-roster");
    returnToTierNightSelectStep({ step: "topic", mode: "roster" });
    assert.equal(getCurrentScreen(), "tiernight-prep");
    resetNav();
  });
});
