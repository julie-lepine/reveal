import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WRONG_ANSWER_PODIUM_POINTS,
  WRONG_ANSWER_POINTS_PER_VOTE,
} from "../data/wrongAnswer.js";
import {
  computeWrongAnswerRoundAward,
  rankWrongAnswerResults,
} from "../js/core/wrongAnswerScoring.js";

/** Podium + couche votes (GAME-WAO-01). */
function expectedPts(rank, votes) {
  const podium = WRONG_ANSWER_PODIUM_POINTS[rank - 1] ?? 0;
  return podium + WRONG_ANSWER_POINTS_PER_VOTE * votes;
}

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
  it("cumule podium 15/10/5 + 5 pts par vote (GAME-WAO-01)", () => {
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
      Bob: expectedPts(1, 3),
      Alice: expectedPts(2, 2),
      Carol: expectedPts(3, 1),
    });
  });

  it("n'attribue rien si aucun vote", () => {
    const answers = { Alice: { text: "a", at: 1 } };
    const { deltas } = computeWrongAnswerRoundAward(answers, {});
    assert.deepEqual(deltas, {});
  });

  it("attribue podium + votes si un seul auteur a des votes", () => {
    const answers = {
      Alice: { text: "a", at: 1 },
      Bob: { text: "b", at: 2 },
    };
    const votes = { Alice: "Alice", Bob: "Alice" };
    const { deltas } = computeWrongAnswerRoundAward(answers, votes);
    assert.deepEqual(deltas, { Alice: expectedPts(1, 2) });
  });

  it("ex æquo en tête : même podium + votes ; suivant saute au palier 3", () => {
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
      Alice: expectedPts(1, 2),
      Bob: expectedPts(1, 2),
      Carol: expectedPts(3, 1),
    });
  });

  it("ex æquo en 2e : même podium + votes ; hors podium marque quand même les votes", () => {
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
      Alice: expectedPts(1, 2),
      Bob: expectedPts(2, 1),
      Carol: expectedPts(2, 1),
    });
  });

  it("hors podium : +5 par vote sans bonus podium", () => {
    const answers = {
      Alice: { text: "a", at: 1 },
      Bob: { text: "b", at: 2 },
      Carol: { text: "c", at: 3 },
      Dave: { text: "d", at: 4 },
    };
    // 4 / 3 / 2 / 1 → rangs 1,2,3,4 (Dave hors podium)
    const votes = {
      A: "Alice",
      B: "Alice",
      C: "Alice",
      D: "Alice",
      E: "Bob",
      F: "Bob",
      G: "Bob",
      H: "Carol",
      I: "Carol",
      J: "Dave",
    };
    const { deltas } = computeWrongAnswerRoundAward(answers, votes);
    assert.deepEqual(deltas, {
      Alice: expectedPts(1, 4),
      Bob: expectedPts(2, 3),
      Carol: expectedPts(3, 2),
      Dave: expectedPts(4, 1),
    });
    assert.equal(deltas.Dave, WRONG_ANSWER_POINTS_PER_VOTE);
  });
});
