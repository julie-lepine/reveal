/**
 * BUG-TIERNIGHT-SCORE-BASELINE-01 — consolidation autorité / hydrate / rollback / frontières.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  beginGameScoreSession,
  buildGameScoreSessionKey,
  captureGameScoreSessionRollbackSnapshot,
  ensureGameScoreSessionForRun,
  evaluateRemoteGameScoreSessionAdoption,
  applyRemoteGameScoreSessionFields,
  flushPendingRemoteGameScoreSession,
  getCurrentSessionScoreMap,
  getState,
  isGameScoreSessionKeyCompatibleWithActiveRun,
  parseGameScoreSessionKey,
  resetEveningState,
  resetScores,
  resolveActiveTierNightScoreRunIdentity,
  resolveGameScoreSessionDisplay,
  restoreGameScoreSessionRollbackSnapshot,
  saveStatePatch,
  setActiveScoringGame,
} from "../js/core/state.js";
import { migrateEveningMapsForRosterRenames } from "../js/core/rosterRenameMigrate.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
function readSrc(rel) {
  return readFileSync(join(__dir, "..", rel), "utf8");
}

function creditTierNight(name, pts) {
  const s = getState();
  const map = { ...(s.gameScores.tiernight || {}) };
  map[name] = (Number(map[name]) || 0) + pts;
  saveStatePatch({
    gameScores: { ...s.gameScores, tiernight: map },
    scores: { ...s.scores, [name]: (Number(s.scores[name]) || 0) + pts },
  });
}

function adoptSeriesRun(runId, phase = "between_rounds") {
  saveStatePatch({
    tierNightGame: {
      runId,
      topicId: "roster:x",
      listName: "Test",
      series: { phase, roundIndex: 0, roundCount: 3 },
      lobbyStarted: true,
    },
    tierNightLiveGame: { lobbyStarted: false, phase: null, runId: null },
  });
}

function adoptLiveRun(runId) {
  saveStatePatch({
    tierNightLiveGame: {
      runId,
      lobbyStarted: true,
      phase: "voting",
      topicId: "t1",
    },
    tierNightGame: { runId, recaps: [], topicId: null, listName: "" },
  });
}

function clearScoreSession() {
  saveStatePatch({
    tierNightGame: { runId: null, series: null, topicId: null },
    tierNightLiveGame: { lobbyStarted: false, phase: null, runId: null },
    scores: {},
    gameScores: {},
    gameScoreSessionBaseline: {},
    gameScoreSessionGameId: null,
    gameScoreSessionKey: null,
    pendingRemoteGameScoreSession: null,
  });
  setActiveScoringGame(null);
}

describe("bugTierNightScoreBaseline01 - consolidation", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    resetScores();
    clearScoreSession();
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  // ——— Identité / clés ———

  it("series-01 key builder: legacy vs series/live", () => {
    assert.equal(buildGameScoreSessionKey({ gameId: "tiernight" }), "tiernight");
    assert.equal(
      buildGameScoreSessionKey({ gameId: "tiernight", mode: "series", runId: "r1" }),
      "tiernight:series:r1"
    );
    assert.deepEqual(parseGameScoreSessionKey("tiernight:live:abc"), {
      gameId: "tiernight",
      mode: "live",
      runId: "abc",
      legacy: false,
    });
  });

  it("series-01 first run first manche delta", () => {
    creditTierNight("Alice", 120);
    adoptSeriesRun("run-a");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "run-a" });
    creditTierNight("Alice", 15);
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 15);
    assert.equal(getState().scores.Alice, 135);
  });

  it("series-02 second manche same run cumulates", () => {
    creditTierNight("Alice", 100);
    adoptSeriesRun("run-b");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "run-b" });
    creditTierNight("Alice", 15);
    creditTierNight("Alice", 10);
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 25);
  });

  it("series-03 series_end same run keeps session total", () => {
    creditTierNight("Alice", 50);
    adoptSeriesRun("run-end", "series_end");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "run-end" });
    creditTierNight("Alice", 40);
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 40);
    assert.equal(getState().gameScores.tiernight.Alice, 90);
  });

  it("series-04 two consecutive series reset internal cumul", () => {
    creditTierNight("Alice", 20);
    adoptSeriesRun("s1");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "s1" });
    creditTierNight("Alice", 11);
    adoptSeriesRun("s2");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "s2" });
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 0);
    assert.equal(getState().gameScores.tiernight.Alice, 31);
  });

  it("series-05/06/07 replay menu change-mode = new run zero delta", () => {
    creditTierNight("Alice", 8);
    adoptSeriesRun("old");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "old" });
    creditTierNight("Alice", 5);
    for (const id of ["replay", "menu", "mode"]) {
      adoptSeriesRun(id);
      ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: id });
      assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 0, id);
    }
  });

  it("series-08 remount same run idempotent", () => {
    adoptSeriesRun("same");
    const a = ensureGameScoreSessionForRun({
      gameId: "tiernight",
      mode: "series",
      runId: "same",
    });
    const b = ensureGameScoreSessionForRun({
      gameId: "tiernight",
      mode: "series",
      runId: "same",
    });
    assert.equal(a.changed, true);
    assert.equal(b.changed, false);
  });

  it("series-09 reload same run restores delta from persisted key+baseline", () => {
    creditTierNight("Alice", 100);
    adoptSeriesRun("persist");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "persist" });
    creditTierNight("Alice", 7);
    const snap = {
      gameScoreSessionKey: getState().gameScoreSessionKey,
      gameScoreSessionGameId: "tiernight",
      gameScoreSessionBaseline: { ...getState().gameScoreSessionBaseline },
      gameScores: { tiernight: { ...getState().gameScores.tiernight } },
    };
    clearScoreSession();
    adoptSeriesRun("persist");
    saveStatePatch(snap);
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 7);
  });

  it("series-10 stale callback old run rejected", () => {
    adoptSeriesRun("new");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "new" });
    const key = getState().gameScoreSessionKey;
    const stale = ensureGameScoreSessionForRun({
      gameId: "tiernight",
      mode: "series",
      runId: "old",
    });
    assert.equal(stale.reason, "STALE_RUN");
    assert.equal(getState().gameScoreSessionKey, key);
  });

  it("series-11 launch failed restores score session snapshot", () => {
    creditTierNight("Alice", 40);
    adoptSeriesRun("before");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "before" });
    const before = captureGameScoreSessionRollbackSnapshot();
    adoptSeriesRun("failed");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "failed" });
    assert.equal(getState().gameScoreSessionKey, "tiernight:series:failed");
    restoreGameScoreSessionRollbackSnapshot(before);
    assert.equal(getState().gameScoreSessionKey, "tiernight:series:before");
    assert.equal(getState().gameScoreSessionBaseline.Alice, 40);
  });

  it("series-12 retry after failure with new runId", () => {
    const empty = captureGameScoreSessionRollbackSnapshot();
    adoptSeriesRun("fail-1");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "fail-1" });
    restoreGameScoreSessionRollbackSnapshot(empty);
    assert.equal(getState().gameScoreSessionKey, null);
    adoptSeriesRun("ok-2");
    const again = ensureGameScoreSessionForRun({
      gameId: "tiernight",
      mode: "series",
      runId: "ok-2",
    });
    assert.equal(again.ok, true);
    assert.equal(again.changed, true);
  });

  it("series-13 baseline captured before first scoring", () => {
    creditTierNight("Alice", 120);
    adoptSeriesRun("order");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "order" });
    assert.equal(getState().gameScoreSessionBaseline.Alice, 120);
    creditTierNight("Alice", 15);
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 15);
  });

  it("series-ensure without active run refused", () => {
    const res = ensureGameScoreSessionForRun({
      gameId: "tiernight",
      mode: "series",
      runId: "orphan",
    });
    assert.equal(res.reason, "NO_ACTIVE_RUN");
  });

  // ——— Rank Live ———

  it("live-14 first Rank Live delta", () => {
    creditTierNight("Alice", 30);
    adoptLiveRun("live-1");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "live", runId: "live-1" });
    creditTierNight("Alice", 8);
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 8);
  });

  it("live-15 two consecutive Rank Live", () => {
    creditTierNight("Alice", 10);
    adoptLiveRun("L1");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "live", runId: "L1" });
    creditTierNight("Alice", 4);
    adoptLiveRun("L2");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "live", runId: "L2" });
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 0);
  });

  it("live-16/17 series↔live transitions", () => {
    adoptSeriesRun("ser");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "ser" });
    adoptLiveRun("liv");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "live", runId: "liv" });
    assert.match(getState().gameScoreSessionKey, /^tiernight:live:/);
    adoptSeriesRun("ser2");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "ser2" });
    assert.match(getState().gameScoreSessionKey, /^tiernight:series:/);
  });

  it("live-18 reload Rank Live", () => {
    creditTierNight("Bob", 5);
    adoptLiveRun("live-reload");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "live", runId: "live-reload" });
    creditTierNight("Bob", 3);
    const key = getState().gameScoreSessionKey;
    const baseline = { ...getState().gameScoreSessionBaseline };
    saveStatePatch({
      gameScoreSessionKey: key,
      gameScoreSessionBaseline: baseline,
      gameScoreSessionGameId: "tiernight",
    });
    assert.equal(getCurrentSessionScoreMap("tiernight").Bob, 3);
  });

  it("live-19 failed live launch rollback score session", () => {
    const before = captureGameScoreSessionRollbackSnapshot();
    adoptLiveRun("live-fail");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "live", runId: "live-fail" });
    restoreGameScoreSessionRollbackSnapshot(before);
    assert.equal(getState().gameScoreSessionKey, null);
  });

  // ——— Multijoueur / hydrate ———

  it("mp-20 host guest same cumul when same key+baseline adopted", () => {
    creditTierNight("Alice", 50);
    adoptSeriesRun("mp");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "mp" });
    creditTierNight("Alice", 12);
    const hostDelta = getCurrentSessionScoreMap("tiernight").Alice;
    // Invité : adopte remote (même snapshot)
    const guestBaseline = { ...getState().gameScoreSessionBaseline };
    const guestKey = getState().gameScoreSessionKey;
    clearScoreSession();
    adoptSeriesRun("mp");
    creditTierNight("Alice", 62); // même total soirée
    applyRemoteGameScoreSessionFields({
      remoteKey: guestKey,
      remoteGameId: "tiernight",
      remoteBaseline: guestBaseline,
    });
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, hostDelta);
  });

  it("mp-21/24 evening before run → buffer then flush", () => {
    const key = "tiernight:series:buf1";
    const decision = evaluateRemoteGameScoreSessionAdoption({
      remoteKey: key,
      remoteGameId: "tiernight",
      remoteBaseline: { Alice: 10 },
      activeRun: null,
    });
    assert.equal(decision.action, "buffer");
    applyRemoteGameScoreSessionFields({
      remoteKey: key,
      remoteGameId: "tiernight",
      remoteBaseline: { Alice: 10 },
    });
    assert.equal(getState().pendingRemoteGameScoreSession?.key, key);
    assert.equal(getState().gameScoreSessionKey, null);
    adoptSeriesRun("buf1");
    const flushed = flushPendingRemoteGameScoreSession();
    assert.equal(flushed.applied, true);
    assert.equal(getState().gameScoreSessionKey, key);
    assert.equal(getState().gameScoreSessionBaseline.Alice, 10);
  });

  it("mp-25 run before evening → adopt when evening arrives", () => {
    adoptSeriesRun("early");
    assert.equal(resolveGameScoreSessionDisplay("tiernight").ready, false);
    applyRemoteGameScoreSessionFields({
      remoteKey: "tiernight:series:early",
      remoteGameId: "tiernight",
      remoteBaseline: { Alice: 3 },
    });
    assert.equal(resolveGameScoreSessionDisplay("tiernight").ready, true);
  });

  it("mp-22 guest hydrate after scoring still correct delta", () => {
    creditTierNight("Alice", 100);
    adoptSeriesRun("late");
    // Pas de baseline local → pending display
    assert.equal(resolveGameScoreSessionDisplay("tiernight").pending, "WAITING_BASELINE");
    creditTierNight("Alice", 20); // scores déjà montés
    applyRemoteGameScoreSessionFields({
      remoteKey: "tiernight:series:late",
      remoteGameId: "tiernight",
      remoteBaseline: { Alice: 100 },
    });
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 20);
  });

  it("mp-23 guest reload mid-run with key", () => {
    creditTierNight("Alice", 10);
    adoptSeriesRun("mid");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "mid" });
    creditTierNight("Alice", 6);
    adoptSeriesRun("mid", "between_rounds");
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 6);
  });

  it("mp-26 remote stale rejected vs active run", () => {
    adoptSeriesRun("cur");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "cur" });
    const res = applyRemoteGameScoreSessionFields({
      remoteKey: "tiernight:series:stale",
      remoteGameId: "tiernight",
      remoteBaseline: { Alice: 999 },
    });
    assert.equal(res.action, "reject");
    assert.equal(getState().gameScoreSessionKey, "tiernight:series:cur");
    assert.notEqual(getState().gameScoreSessionBaseline.Alice, 999);
  });

  it("mp-27 remote matching active run replaces", () => {
    adoptSeriesRun("cur2");
    const res = applyRemoteGameScoreSessionFields({
      remoteKey: "tiernight:series:cur2",
      remoteGameId: "tiernight",
      remoteBaseline: { Alice: 44 },
    });
    assert.equal(res.applied, true);
    assert.equal(getState().gameScoreSessionBaseline.Alice, 44);
  });

  it("mp-28 guest cannot overwrite host key with orphan local capture", () => {
    adoptSeriesRun("host-run");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "host-run" });
    // Tentative « invité » : ensure d’un autre run refusé
    const bad = ensureGameScoreSessionForRun({
      gameId: "tiernight",
      mode: "series",
      runId: "guest-local",
    });
    assert.equal(bad.reason, "STALE_RUN");
  });

  it("mp-compat classic key cannot contaminate series", () => {
    adoptSeriesRun("same-id");
    const compat = isGameScoreSessionKeyCompatibleWithActiveRun(
      "tiernight:classic:same-id"
    );
    assert.equal(compat.ok, false);
    assert.equal(compat.reason, "MODE_MISMATCH");
  });

  it("mp-display waiting when baseline missing (no faux cumul)", () => {
    adoptSeriesRun("wait");
    const view = resolveGameScoreSessionDisplay("tiernight");
    assert.equal(view.ready, false);
    assert.equal(view.pending, "WAITING_BASELINE");
    assert.deepEqual(view.scores, {});
    const src = readSrc("js/core/gameScores.js");
    assert.match(src, /data-scores-pending/);
    assert.match(src, /Synchronisation des scores/);
    assert.match(src, /resolveGameScoreSessionDisplay/);
  });

  // ——— Frontières ———

  it("boundary-29 new lobby/evening clears score session not evening totals path", () => {
    creditTierNight("Alice", 70);
    adoptSeriesRun("lobbyA");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "lobbyA" });
    resetEveningState();
    assert.equal(getState().gameScoreSessionKey, null);
    assert.equal(getState().gameScoreSessionGameId, null);
    assert.deepEqual(getState().gameScoreSessionBaseline, {});
    assert.deepEqual(getState().gameScores, {});
  });

  it("boundary-30 leave/dissolve via resetScores clears key+baseline", () => {
    adoptSeriesRun("leave");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "leave" });
    resetScores();
    assert.equal(getState().gameScoreSessionKey, null);
    assert.equal(getState().pendingRemoteGameScoreSession, null);
  });

  it("boundary-31 other game between TierNight runs", () => {
    creditTierNight("Alice", 15);
    adoptSeriesRun("t1");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "t1" });
    creditTierNight("Alice", 5);
    beginGameScoreSession("hottake");
    adoptSeriesRun("t2");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "t2" });
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 0);
    assert.equal(getState().gameScores.tiernight.Alice, 20);
  });

  it("boundary-32 evening scores stay cumulative across runs", () => {
    creditTierNight("Alice", 10);
    adoptSeriesRun("e1");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "e1" });
    creditTierNight("Alice", 5);
    adoptSeriesRun("e2");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "e2" });
    creditTierNight("Alice", 7);
    assert.equal(getState().scores.Alice, 22);
    assert.equal(getCurrentSessionScoreMap("tiernight").Alice, 7);
  });

  // ——— Identité displayName ———

  it("id-33 rename migrates baseline prefer-old", () => {
    const migrated = migrateEveningMapsForRosterRenames(
      {
        scores: { Old: 10 },
        playerStats: {},
        gameScores: { tiernight: { Old: 10 } },
        gameScoreSessionBaseline: { Old: 10 },
      },
      [{ oldName: "Old", newName: "New" }]
    );
    assert.equal(migrated.gameScoreSessionBaseline.New, 10);
    assert.equal(migrated.gameScoreSessionBaseline.Old, undefined);
  });

  it("id-34 player absent from baseline gets full credited delta", () => {
    creditTierNight("Alice", 10);
    adoptSeriesRun("join");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "join" });
    creditTierNight("Bob", 9);
    const map = getCurrentSessionScoreMap("tiernight");
    assert.equal(map.Alice, 0);
    assert.equal(map.Bob, 9);
  });

  it("id-35/36 non-numeric and finite deltas", () => {
    adoptSeriesRun("nan");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "nan" });
    saveStatePatch({
      gameScores: { tiernight: { Alice: "nope", Bob: 5 } },
      gameScoreSessionBaseline: { Alice: 1, Bob: "x" },
      gameScoreSessionGameId: "tiernight",
    });
    const map = getCurrentSessionScoreMap("tiernight");
    assert.equal(Number.isFinite(map.Alice), true);
    assert.equal(Number.isFinite(map.Bob), true);
    assert.equal(map.Alice, -1); // 0 - 1 ; divergence visible, pas clamp silencieux
    assert.equal(map.Bob, 5);
  });

  it("legacy remote without key rejected while series active", () => {
    adoptSeriesRun("leg");
    ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "series", runId: "leg" });
    const res = applyRemoteGameScoreSessionFields({
      remoteGameId: "tiernight",
      remoteBaseline: { Alice: 1 },
    });
    assert.equal(res.action, "reject");
    assert.equal(res.reason, "LEGACY_WITHOUT_KEY");
  });

  it("hub shell runId is not active score run", () => {
    saveStatePatch({
      tierNightGame: { runId: "hub", topicId: null, series: null },
      tierNightLiveGame: { lobbyStarted: false, runId: null },
    });
    assert.equal(resolveActiveTierNightScoreRunIdentity(), null);
  });
});
