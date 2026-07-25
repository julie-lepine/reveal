import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WRONG_ANSWER_PODIUM_POINTS } from "../data/wrongAnswer.js";
import {
  computeWrongAnswerRoundAward,
  rankWrongAnswerResults,
} from "../js/core/wrongAnswerScoring.js";

describe("rankWrongAnswerResults", () => {
  it("classe par votes décroissants", () => {
    const answers = {
      Alice: { text: "a", at: 1 },
      Bob: { text: "b", at: 2 },
      Carol: { text: "c", at: 3 },
    };
    const votes = { Alice: "Bob", Bob: "Bob", Carol: "Carol", Dave: "Alice" };
    const ranking = rankWrongAnswerResults(answers, votes);
    assert.deepEqual(
      ranking.map((r) => r.name),
      ["Bob", "Alice", "Carol"]
    );
    assert.deepEqual(
      ranking.map((r) => r.votes),
      [2, 1, 1]
    );
  });

  it("ne départage pas l'ex-aequo par at (ordre de nom stable)", () => {
    const answers = {
      Alice: { text: "a", at: 200 },
      Bob: { text: "b", at: 100 },
    };
    const votes = { Alice: "Alice", Bob: "Bob", Carol: "Alice", Dave: "Bob" };
    const ranking = rankWrongAnswerResults(answers, votes);
    assert.deepEqual(
      ranking.map((r) => r.name),
      ["Alice", "Bob"]
    );
    assert.deepEqual(
      ranking.map((r) => r.votes),
      [2, 2]
    );
  });
});

describe("computeWrongAnswerRoundAward", () => {
  it("attribue le podium 15 / 10 / 5", () => {
    const answers = {
      Alice: { text: "a", at: 1 },
      Bob: { text: "b", at: 2 },
      Carol: { text: "c", at: 3 },
      Dave: { text: "d", at: 4 },
    };
    const votes = {
      Alice: "Bob",
      Bob: "Bob",
      Carol: "Bob",
      Dave: "Alice",
      Eve: "Carol",
      Fran: "Alice",
    };

    const { deltas } = computeWrongAnswerRoundAward(answers, votes);
    assert.deepEqual(deltas, {
      Bob: WRONG_ANSWER_PODIUM_POINTS[0],
      Alice: WRONG_ANSWER_PODIUM_POINTS[1],
      Carol: WRONG_ANSWER_PODIUM_POINTS[2],
    });
  });

  it("n'attribue rien si aucun vote", () => {
    const answers = { Alice: { text: "a", at: 1 } };
    const { deltas } = computeWrongAnswerRoundAward(answers, {});
    assert.deepEqual(deltas, {});
  });

  it("attribue seulement le 1er si un seul auteur a des votes", () => {
    const answers = {
      Alice: { text: "a", at: 1 },
      Bob: { text: "b", at: 2 },
    };
    const votes = { Alice: "Alice", Bob: "Alice" };
    const { deltas } = computeWrongAnswerRoundAward(answers, votes);
    assert.deepEqual(deltas, { Alice: 15 });
  });

  it("ex æquo en tête : même +15, suivant saute au palier 3 (+5)", () => {
    const answers = {
      Alice: { text: "a", at: 200 },
      Bob: { text: "b", at: 100 },
      Carol: { text: "c", at: 50 },
    };
    const votes = {
      Alice: "Alice",
      Bob: "Bob",
      Carol: "Alice",
      Dave: "Bob",
      Eve: "Carol",
    };
    const { deltas } = computeWrongAnswerRoundAward(answers, votes);
    assert.deepEqual(deltas, {
      Alice: WRONG_ANSWER_PODIUM_POINTS[0],
      Bob: WRONG_ANSWER_PODIUM_POINTS[0],
      Carol: WRONG_ANSWER_PODIUM_POINTS[2],
    });
  });

  it("ex æquo en 2e : même +10, plus de slot +5", () => {
    const answers = {
      Alice: { text: "a", at: 1 },
      Bob: { text: "b", at: 2 },
      Carol: { text: "c", at: 3 },
    };
    const votes = {
      Alice: "Alice",
      Bob: "Alice",
      Carol: "Bob",
      Dave: "Carol",
    };
    const { deltas } = computeWrongAnswerRoundAward(answers, votes);
    assert.deepEqual(deltas, {
      Alice: WRONG_ANSWER_PODIUM_POINTS[0],
      Bob: WRONG_ANSWER_PODIUM_POINTS[1],
      Carol: WRONG_ANSWER_PODIUM_POINTS[1],
    });
  });
});
