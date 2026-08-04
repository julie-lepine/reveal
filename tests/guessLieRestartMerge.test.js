/**
 * Guess Lie - merge restart légitime (fin de partie → Recommencer).
 * Simule mergeGuessLieGameLocal (gameSync) via les helpers sessionMerge exportés.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldApplyGuessLieLobbyReset,
  mergeGuessLieLobbyComplete,
  mergeGuessLieSubmissions,
  mergeForwardGamePhase,
  isGuessLieInPrep,
  isGuessLieMergedPrepState,
  isGuessLiePlaySessionActive,
} from "../js/core/sessionMerge.js";

/** Miroir minimal de mergeGuessLieGameLocal (gameSync) pour les tests merge. */
function mergeGuessLieGameLocalForTest(local, remote) {
  const lobbyReset = shouldApplyGuessLieLobbyReset(local, remote);
  const inPrep = isGuessLieInPrep(local, remote);
  return {
    ...local,
    ...remote,
    submissions: mergeGuessLieSubmissions(local.submissions || {}, remote.submissions || {}, {
      reset: lobbyReset,
      prepPhase: inPrep && !lobbyReset,
    }),
    phase: mergeForwardGamePhase(local.phase, remote.phase),
    votes: lobbyReset ? remote.votes || {} : { ...(remote.votes || {}), ...(local.votes || {}) },
    roundScored: lobbyReset ? Boolean(remote.roundScored) : Boolean(local.roundScored || remote.roundScored),
    roundIdx: remote.roundIdx ?? local.roundIdx ?? 0,
    lobbyComplete: mergeGuessLieLobbyComplete(local, remote, { lobbyReset }),
  };
}

function guessLieEntryFromSession(session) {
  if (isGuessLiePlaySessionActive(session)) return "guesslie";
  const subs = session.submissions || {};
  if (Object.keys(subs).length === 0) return "guesslie-menu";
  return "guesslie-wait";
}

describe("Guess Lie restart merge (fin de partie → Recommencer)", () => {
  const postGameLocal = {
    lobbyComplete: true,
    phase: "idle",
    roundIdx: 2,
    roundScored: true,
    submissions: {
      Alice: { statements: ["V1", "V2", "V3"], lie: 1 },
      Bob: { statements: ["A", "B", "C"], lie: 0 },
    },
    votes: { Alice: 2, Bob: 1 },
    statsRecordedRoundIdx: 2,
  };

  const hostRestartRemote = {
    sessionId: "LOBBY1",
    lobbyComplete: false,
    phase: null,
    roundIdx: 0,
    roundScored: false,
    submissions: {},
    votes: {},
    statsRecordedRoundIdx: -1,
  };

  it("lobbyComplete repasse à false après merge restart", () => {
    const merged = mergeGuessLieGameLocalForTest(postGameLocal, hostRestartRemote);
    assert.equal(merged.lobbyComplete, false);
  });

  it("submissions sont réinitialisées", () => {
    const merged = mergeGuessLieGameLocalForTest(postGameLocal, hostRestartRemote);
    assert.deepEqual(merged.submissions, {});
  });

  it("getGuessLieEntryScreen résout guesslie-menu (via isGuessLiePlaySessionActive)", () => {
    const merged = mergeGuessLieGameLocalForTest(postGameLocal, hostRestartRemote);
    assert.equal(isGuessLieMergedPrepState(merged), true);
    assert.equal(isGuessLiePlaySessionActive(merged), false);
    assert.equal(guessLieEntryFromSession(merged), "guesslie-menu");
  });

  it("non-régression : reset prep obsolète pendant voting conserve lobbyComplete", () => {
    const local = { lobbyComplete: true, phase: "voting", roundIdx: 1, submissions: {} };
    const staleRemote = {
      lobbyComplete: false,
      phase: null,
      roundIdx: 0,
      roundScored: false,
      submissions: {},
      votes: {},
    };
    const merged = mergeGuessLieGameLocalForTest(local, staleRemote);
    assert.equal(shouldApplyGuessLieLobbyReset(local, staleRemote), false);
    assert.equal(merged.lobbyComplete, true);
    assert.equal(isGuessLiePlaySessionActive(merged), true);
  });
});
