import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { HOT_TAKE_POINTS_TIE } from "../data/hotTakes.js";
import { DILEMMA_POINTS_MAJORITY_WIN } from "../data/dilemma.js";
import { CLUTCH_PODIUM_POINTS } from "../data/clutch.js";
import { WRONG_ANSWER_PODIUM_POINTS } from "../data/wrongAnswer.js";
import { TRIVIA_POINTS_FASTEST, TRIVIA_LOBBY_PODIUM_POINTS } from "../data/trivia.js";
import { EVENING_POINTS } from "../data/eveningScoring.js";

describe("barèmes soirée (constantes)", () => {
  it("podiums manche Clutch / Wrong Answer = 15/10/5", () => {
    assert.deepEqual(CLUTCH_PODIUM_POINTS, [15, 10, 5]);
    assert.deepEqual(WRONG_ANSWER_PODIUM_POINTS, [15, 10, 5]);
  });

  it("Trivia : rapide +5, podium soirée 15/10/5", () => {
    assert.equal(TRIVIA_POINTS_FASTEST, 5);
    assert.deepEqual(TRIVIA_LOBBY_PODIUM_POINTS, [15, 10, 5]);
  });

  it("Dilemma majorité = +15, Hot Take égalité = +5", () => {
    assert.equal(DILEMMA_POINTS_MAJORITY_WIN, EVENING_POINTS.BONUS);
    assert.equal(HOT_TAKE_POINTS_TIE, 5);
  });
});
