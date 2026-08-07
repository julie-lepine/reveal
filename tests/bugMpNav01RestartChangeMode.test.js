/**
 * BUG-MP-NAV-01 / 01B — Hôte « Recommencer » / « Changer de mode » : invité suit.
 *
 * 01 : late-patch post-game no-op silencieux.
 * 01B : destinations admises (pas toute string) ; CAS A acting host ;
 *       SCREEN_MISMATCH strict ; branches Rank Live produit.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        unsubscribe: () => {},
      }),
    },
  },
});

const {
  shouldBlockLateGamePatchAfterPostGame,
  isAdmittedPostGameExitScreen,
  POST_GAME_SCREENS,
} = await import("../js/core/gameSync.js");

const {
  buildSeriesExitRemoteMutation,
  resolveChangeModeDestination,
  resolveReplayDestination,
  buildClearedTierNightSeriesRemote,
  shouldReplayTierNightSeriesToPrep,
  canAuthorSeriesExit,
  canAuthorSeriesQuit,
} = await import("../js/core/tierNightSeriesExitNav.js");

const GAME_SETUP = new Set([
  "tiernight-select",
  "tiernight-prep",
  "hottake-prep",
  "consensus-prep",
]);

function guestMustFollow({ target, current, isHost = false, inLobby = true }) {
  if (!target || isHost || !inLobby) return false;
  if (!GAME_SETUP.has(target)) return false;
  if (current === target) return false;
  return true;
}

function simulateHostExitNav({
  fromScreen,
  toScreen,
  stateMerge,
  blockLatePatchFn,
}) {
  const remoteBefore = {
    screen: fromScreen,
    game_id: "tiernight",
    state: {
      tierNight: {
        runId: "run-1",
        series: { phase: "series_end", roundHistory: [{ topicId: "t1" }] },
        lobbyStarted: false,
        recap: { runId: "run-1", recaps: [{ player: "A", placed: { S: ["x"] } }] },
      },
    },
  };

  const wouldBlock = blockLatePatchFn(remoteBefore, stateMerge, toScreen);
  let remoteAfter = remoteBefore;
  let hostLocalNav = false;
  let writeHappened = false;

  if (!wouldBlock) {
    remoteAfter = {
      ...remoteBefore,
      screen: toScreen,
      state: {
        ...remoteBefore.state,
        ...stateMerge,
        tierNight: {
          ...remoteBefore.state.tierNight,
          ...stateMerge.tierNight,
        },
      },
    };
    writeHappened = true;
    hostLocalNav = true;
  } else {
    hostLocalNav = true;
    writeHappened = false;
  }

  const guestCurrent = fromScreen;
  const guestSees = remoteAfter.screen;
  const guestFollows =
    writeHappened &&
    guestMustFollow({ target: guestSees, current: guestCurrent, isHost: false });

  return {
    wouldBlock,
    writeHappened,
    hostLocalNav,
    hostOnlyNav: hostLocalNav && !writeHappened,
    guestScreen: guestFollows ? guestSees : guestCurrent,
    guestFollows,
    remoteAfter,
  };
}

function legacyBlockLate(row, stateMerge) {
  const PLAY = new Set(["tierNight", "tierNightLive", "hotTake", "guessLie"]);
  if (!row || !POST_GAME_SCREENS.has(row.screen)) return false;
  return Object.keys(stateMerge || {}).some((k) => PLAY.has(k));
}

/** Miroir SCREEN_MISMATCH décisionnel (applySeriesClearAndPrepReset). */
function decideScreenMismatch({ row, targetScreen, navigateCalledRef }) {
  const remoteScreen = row?.screen ?? null;
  if (!row || remoteScreen !== targetScreen) {
    return {
      ok: false,
      code: "SCREEN_MISMATCH",
      rolledBack: true,
      navigated: navigateCalledRef.value,
    };
  }
  navigateCalledRef.value = true;
  return { ok: true, navigated: true };
}

describe("BUG-MP-NAV-01B — POST_GAME inventaire + matrice garde", () => {
  it("POST_GAME exact = results, leaderboard, tiernight-end", () => {
    assert.deepEqual([...POST_GAME_SCREENS].sort(), [
      "leaderboard",
      "results",
      "tiernight-end",
    ]);
  });

  it("A. post-game + aucune screen → BLOQUÉ", () => {
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "tiernight-end" },
        { tierNight: { placements: {} } },
        null
      ),
      true
    );
  });

  it("B. post-game + screen cible identique → BLOQUÉ", () => {
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "tiernight-end" },
        { tierNight: { placements: {} } },
        "tiernight-end"
      ),
      true
    );
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "results" },
        { hotTake: { votes: {} } },
        "results"
      ),
      true
    );
  });

  it("C. post-game + destination admise → autorisé", () => {
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "tiernight-end" },
        { tierNight: { series: null } },
        "tiernight-select"
      ),
      false
    );
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "tiernight-end" },
        { tierNight: { series: null } },
        "tiernight-prep"
      ),
      false
    );
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "results" },
        { hotTake: { lobbyStarted: false } },
        "hottake-prep"
      ),
      false
    );
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "results" },
        { consensus: {} },
        "game-select"
      ),
      false
    );
  });

  it("D. post-game + destination invalide/inconnue → NE contourne PAS", () => {
    assert.equal(isAdmittedPostGameExitScreen("not-a-real-screen"), false);
    assert.equal(isAdmittedPostGameExitScreen("hottake"), false);
    assert.equal(isAdmittedPostGameExitScreen("tiernight"), false);
    assert.equal(isAdmittedPostGameExitScreen("foobar"), false);
    assert.equal(isAdmittedPostGameExitScreen(""), false);
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "tiernight-end" },
        { tierNight: { placements: { A: {} } } },
        "not-a-real-screen"
      ),
      true
    );
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "tiernight-end" },
        { tierNight: { placements: { A: {} } } },
        "hottake"
      ),
      true
    );
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "results" },
        { hotTake: { votes: { u1: 1 } } },
        "evil-bypass"
      ),
      true
    );
  });

  it("E. hors post-game → jamais bloqué par cette garde", () => {
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "tiernight-between" },
        { tierNight: { series: null } },
        "tiernight-select"
      ),
      false
    );
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        { screen: "hottake" },
        { hotTake: { votes: {} } },
        null
      ),
      false
    );
  });
});

describe("BUG-MP-NAV-01 — simulation HOST / GUEST", () => {
  it("régression legacy : change mode = nav hôte seule", () => {
    const dest = resolveChangeModeDestination();
    const remote = buildSeriesExitRemoteMutation({ screen: dest.screen });
    const sim = simulateHostExitNav({
      fromScreen: "tiernight-end",
      toScreen: dest.screen,
      stateMerge: remote.stateMerge,
      blockLatePatchFn: legacyBlockLate,
    });
    assert.equal(sim.hostOnlyNav, true);
    assert.equal(sim.guestFollows, false);
  });

  it("fix : change mode écrit remote + guest suit", () => {
    const dest = resolveChangeModeDestination();
    const remote = buildSeriesExitRemoteMutation({ screen: dest.screen });
    const sim = simulateHostExitNav({
      fromScreen: "tiernight-end",
      toScreen: dest.screen,
      stateMerge: remote.stateMerge,
      blockLatePatchFn: shouldBlockLateGamePatchAfterPostGame,
    });
    assert.equal(sim.writeHappened, true);
    assert.equal(sim.guestFollows, true);
    assert.equal(sim.guestScreen, "tiernight-select");
  });

  it("fix : recommencer série → prep, guest suit", () => {
    const dest = resolveReplayDestination({ seriesUiEnabled: true });
    const remote = buildSeriesExitRemoteMutation({ screen: dest.screen });
    const sim = simulateHostExitNav({
      fromScreen: "tiernight-end",
      toScreen: dest.screen,
      stateMerge: remote.stateMerge,
      blockLatePatchFn: shouldBlockLateGamePatchAfterPostGame,
    });
    assert.equal(sim.guestScreen, "tiernight-prep");
  });
});

describe("BUG-MP-NAV-01B — SCREEN_MISMATCH", () => {
  it("bonne réponse remote → navigation", () => {
    const nav = { value: false };
    const d = decideScreenMismatch({
      row: { screen: "tiernight-select" },
      targetScreen: "tiernight-select",
      navigateCalledRef: nav,
    });
    assert.equal(d.ok, true);
    assert.equal(d.navigated, true);
  });

  it("mauvaise screen → rollback conceptuel, aucune navigation", () => {
    const nav = { value: false };
    const d = decideScreenMismatch({
      row: { screen: "tiernight-end" },
      targetScreen: "tiernight-select",
      navigateCalledRef: nav,
    });
    assert.equal(d.ok, false);
    assert.equal(d.code, "SCREEN_MISMATCH");
    assert.equal(d.navigated, false);
  });

  it("row null / screen manquant → SCREEN_MISMATCH", () => {
    const nav = { value: false };
    assert.equal(
      decideScreenMismatch({
        row: null,
        targetScreen: "tiernight-select",
        navigateCalledRef: nav,
      }).code,
      "SCREEN_MISMATCH"
    );
    assert.equal(
      decideScreenMismatch({
        row: { screen: undefined },
        targetScreen: "tiernight-prep",
        navigateCalledRef: nav,
      }).code,
      "SCREEN_MISMATCH"
    );
  });

  it("contrat code : mismatch avant navigate ; pas de finally navigate", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /SCREEN_MISMATCH/);
    assert.match(exit, /remoteScreen !== screen/);
    assert.match(exit, /!row \|\| remoteScreen !== screen/);
    assert.doesNotMatch(
      exit.match(/async function applySeriesClearAndPrepReset[\s\S]*?^\}/m)?.[0] || "",
      /finally\s*\{[\s\S]*navigate/
    );
    assert.match(
      exit,
      /changeTierNightModeFromSeriesPlay[\s\S]*?if \(!res\.ok\)[\s\S]*?navigateToDestination/
    );
  });

  it("updateGameSession sélectionne screen serveur (pas fallback local inventé)", () => {
    const sg = read("js/core/supabaseGame.js");
    assert.match(sg, /\.select\("id, lobby_id, game_id, screen, host_id, updated_at"\)/);
  });
});

describe("BUG-MP-NAV-01B — acting host CAS A", () => {
  it("canAuthorSeriesExit = hôte réel only", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    const block = exit.match(/export function canAuthorSeriesExit[\s\S]*?^\}/m)?.[0];
    assert.ok(block);
    assert.match(block, /isLobbyHost\(\)/);
    assert.doesNotMatch(block, /canActAsHost/);
    assert.equal(typeof canAuthorSeriesExit, "function");
    assert.equal(typeof canAuthorSeriesQuit, "function");
  });

  it("UI : change mode / recommencer derrière realHost ; next derrière AH", () => {
    const between = read("js/screens/tierNightBetween.js");
    const end = read("js/screens/tierNightEnd.js");
    const restart = read("js/core/restartGame.js");
    assert.match(between, /realHost\s*\?\s*`[\s\S]*?btn-tiernight-change-mode/);
    assert.match(between, /onChangeMode[\s\S]*!isLobbyHost\(\)\) return/);
    assert.match(between, /onNextTheme[\s\S]*isLobbyHost\(\) \|\| canActAsHost\(\)/);
    assert.match(end, /realHost[\s\S]*btn-tiernight-end-change-mode/);
    assert.match(end, /onChangeMode[\s\S]*!isLobbyHost\(\)\) return/);
    assert.match(restart, /eveningRecapRestartButtonHtml[\s\S]*!isLobbyHost\(\)\) return ""/);
  });

  it("pourquoi AH ne peut pas : multi-clé + screens AH SQL", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /Patch acting host : un seul jeu à la fois/);
    const remote = buildSeriesExitRemoteMutation({ screen: "tiernight-select" });
    assert.deepEqual(Object.keys(remote.stateMerge).sort(), [
      "tierNight",
      "tierNightPrep",
    ]);
    assert.equal(Object.keys(remote.stateMerge).length, 2);
  });
});

describe("BUG-MP-NAV-01B — branches Recommencer produit", () => {
  it("series_end roster → shouldReplay true → prep", () => {
    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: true,
        tierNight: {
          mode: "roster",
          series: { phase: "series_end" },
          lobbyStarted: false,
        },
        tierNightLive: { lobbyStarted: false, finished: true },
      }),
      true
    );
    assert.equal(
      resolveReplayDestination({ seriesUiEnabled: true }).screen,
      "tiernight-prep"
    );
  });

  it("Rank Live mode → shouldReplay false → hub select (produit voulu)", () => {
    // Rank Live fin : pas de phase series_end — blob live finished, mode live.
    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: true,
        tierNight: { mode: "live", series: null },
        tierNightLive: { lobbyStarted: false, finished: true },
        tierNightMode: "live",
      }),
      false
    );
    const restart = read("js/core/restartGame.js");
    assert.match(restart, /launchTierNightSelect/);
    assert.match(restart, /shouldReplayTierNightSeriesToPrep/);
    // Branche registry : !shouldReplay → launchTierNightSelect (hub).
    assert.match(
      restart,
      /if \(shouldReplayTierNightSeriesToPrep\(\)\)[\s\S]*replayTierNightAfterSeriesEnd[\s\S]*restartLock\.run\(\(\) => fn\(\)\)/
    );
  });

  it("live encore en cours → pas de replay prep", () => {
    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: true,
        tierNight: { mode: "roster" },
        tierNightLive: { lobbyStarted: true, finished: false },
      }),
      false
    );
  });

  it("Changer de mode → toujours tiernight-select", () => {
    const dest = resolveChangeModeDestination();
    assert.equal(dest.screen, "tiernight-select");
    assert.equal(dest.params.step, "mode");
  });

  it("choix de branche au clic : vérité locale series/mode encore lue", () => {
    const restart = read("js/core/restartGame.js");
    assert.match(
      restart,
      /shouldReplayTierNightSeriesToPrep\(\)[\s\S]*replayTierNightAfterSeriesEnd/
    );
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(
      exit,
      /tierNight = getState\(\)\.tierNightGame[\s\S]*tierNightLive = getState\(\)\.tierNightLiveGame/
    );
  });
});

describe("BUG-MP-NAV-01 — contrats remote / handlers", () => {
  it("clear remote : series null + recap null", () => {
    const cleared = buildClearedTierNightSeriesRemote();
    assert.equal(cleared.series, null);
    assert.equal(cleared.recap, null);
  });

  it("mutation = patchGameState (pas complete / start)", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /patchGameState\(remote\.stateMerge/);
    assert.doesNotMatch(exit, /completeGameSession|startGameSession/);
  });

  it("garde late-patch : admitted exit + screen passé", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /isAdmittedPostGameExitScreen/);
    assert.match(
      sync,
      /isLateGamePatchAfterPostGame\(freshRow,\s*mergePayload,\s*screen\)/
    );
  });
});
