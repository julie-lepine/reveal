import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planGuessLiePlayWrite,
  buildGuessLieActingPlayFields,
} from "../js/core/guessLiePlayCommit.js";
import {
  ACTING_HOST_PLAY_ALLOWED_KEYS,
  validateActingHostPlayPatch,
} from "../js/core/gameSessionSecurity.js";
import { pickRemotePlayFields } from "../js/core/playPatch.js";

/** Miroir minimal de guessLieToRemote (sans state/supabase) pour les tests de champs. */
function guessLieToRemoteLite(gl) {
  return {
    sessionId: gl.sessionId,
    lobbyComplete: Boolean(gl.lobbyComplete),
    roundIdx: gl.roundIdx ?? 0,
    phase: gl.phase || null,
    votes: gl.votes || {},
    roundScored: Boolean(gl.roundScored),
    statsRecordedRoundIdx: gl.statsRecordedRoundIdx ?? -1,
  };
}

describe("planGuessLiePlayWrite (I-08 Guess Lie)", () => {
  it("1. hôte réel → chemin patchGameState (evening conservé)", () => {
    const plan = planGuessLiePlayWrite({
      isSyncActive: true,
      isRealHost: true,
      canAct: true,
      withEveningScores: true,
    });
    assert.equal(plan.channel, "patchGameState");
    assert.equal(plan.withEveningScores, true);
  });

  it("2. acting host → chemin actingRpc, sans UPDATE direct, evening forcé false", () => {
    const plan = planGuessLiePlayWrite({
      isSyncActive: true,
      isRealHost: false,
      canAct: true,
      withEveningScores: true,
    });
    assert.equal(plan.channel, "actingRpc");
    assert.equal(plan.withEveningScores, false);
  });

  it("3. invité non acting → noop (aucune progression distante)", () => {
    const plan = planGuessLiePlayWrite({
      isSyncActive: true,
      isRealHost: false,
      canAct: false,
      withEveningScores: false,
    });
    assert.equal(plan.channel, "noop");
  });

  it("6. scores de soirée désactivés pour l'acting host même si demandé", () => {
    const plan = planGuessLiePlayWrite({
      isSyncActive: true,
      isRealHost: false,
      canAct: true,
      withEveningScores: true,
    });
    assert.equal(plan.withEveningScores, false);
  });

  it("solo hors sync → local only", () => {
    assert.equal(
      planGuessLiePlayWrite({
        isSyncActive: false,
        isRealHost: false,
        canAct: false,
      }).channel,
      "local"
    );
  });
});

describe("buildGuessLieActingPlayFields", () => {
  const base = {
    sessionId: "ABC",
    lobbyComplete: true,
    roundIdx: 0,
    phase: "voting",
    votes: { u1: 1 },
    roundScored: false,
    statsRecordedRoundIdx: -1,
  };

  it("5. reveal → phase/roundScored whitelist OK ; statsRecordedRoundIdx omis (succès RPC)", () => {
    const patch = {
      phase: "reveal",
      roundScored: true,
      statsRecordedRoundIdx: 0,
    };
    const remote = guessLieToRemoteLite({ ...base, ...patch });
    const fields = buildGuessLieActingPlayFields(remote, patch);
    assert.equal(fields.phase, "reveal");
    assert.equal(fields.roundScored, true);
    assert.equal(Object.prototype.hasOwnProperty.call(fields, "statsRecordedRoundIdx"), false);
    assert.equal(validateActingHostPlayPatch(fields).ok, true);
  });

  it("manche suivante → roundIdx / phase / votes / roundScored couverts", () => {
    const patch = {
      roundIdx: 1,
      phase: "voting",
      votes: {},
      roundScored: false,
    };
    const remote = guessLieToRemoteLite({ ...base, ...patch });
    const fields = buildGuessLieActingPlayFields(remote, patch);
    assert.deepEqual(
      Object.keys(fields).sort(),
      ["phase", "roundIdx", "roundScored", "votes"].sort()
    );
    assert.equal(fields.roundIdx, 1);
    assert.equal(fields.phase, "voting");
    assert.equal(validateActingHostPlayPatch(fields).ok, true);
    for (const key of Object.keys(fields)) {
      assert.equal(ACTING_HOST_PLAY_ALLOWED_KEYS.has(key), true, key);
    }
  });

  it("4. contrat échec : statsRecordedRoundIdx brut hors whitelist → fantôme évité par strip", () => {
    const raw = pickRemotePlayFields(
      guessLieToRemoteLite({ ...base, statsRecordedRoundIdx: 2, phase: "reveal", roundScored: true }),
      { phase: "reveal", roundScored: true, statsRecordedRoundIdx: 2 }
    );
    assert.equal(raw.statsRecordedRoundIdx, 2);
    assert.equal(validateActingHostPlayPatch(raw).ok, false);
    assert.equal(validateActingHostPlayPatch(raw).key, "statsRecordedRoundIdx");
    const stripped = buildGuessLieActingPlayFields(
      guessLieToRemoteLite({ ...base, phase: "reveal", roundScored: true, statsRecordedRoundIdx: 2 }),
      { phase: "reveal", roundScored: true, statsRecordedRoundIdx: 2 }
    );
    assert.equal(validateActingHostPlayPatch(stripped).ok, true);
  });
});
