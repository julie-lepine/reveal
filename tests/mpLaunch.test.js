import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickRemotePlayFields } from "../js/core/playPatch.js";

describe("pickRemotePlayFields", () => {
  it("n'envoie que les clés du patch présentes dans le remote", () => {
    const full = {
      phase: "reveal",
      roundIdx: 2,
      deck: [{ id: 1 }],
      votes: { u1: 0 },
    };
    const patch = { phase: "reveal", roundIdx: 2, deck: full.deck };
    assert.deepEqual(pickRemotePlayFields(full, patch), {
      phase: "reveal",
      roundIdx: 2,
    });
  });

  it("ignore les champs prep même si spread session complet", () => {
    const full = {
      deck: [1, 2, 3],
      lobbyStarted: true,
      phase: "reveal",
      matchScores: { a: 5 },
    };
    const patch = { ...full, phase: "reveal" };
    assert.deepEqual(pickRemotePlayFields(full, patch), {
      phase: "reveal",
      matchScores: { a: 5 },
    });
  });
});
