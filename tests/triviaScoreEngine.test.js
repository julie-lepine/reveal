import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreTriviaRoundFromAnswers, pickFastestTriviaEntry, isValidTriviaAnswerIndex, sortCorrectEntriesForReveal } from "../js/core/triviaScoreEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures", "trivia-scoring");

function loadFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      name,
      data: JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8")),
    }));
}

describe("triviaScoreEngine — golden fixtures", () => {
  for (const { name, data } of loadFixtures()) {
    it(name, () => {
      const result = scoreTriviaRoundFromAnswers({
        correctIndex: data.correctIndex,
        correctAnswer: data.correctAnswer,
        answers: data.answers,
        matchScores: data.matchScores,
      });
      assert.deepEqual(result.matchScores, data.expected.matchScores);
      assert.deepEqual(result.lastRound, data.expected.lastRound);
    });
  }
});

describe("pickFastestTriviaEntry — tie-break stable", () => {
  it("answeredAt ASC puis uid ASC", () => {
    const fastest = pickFastestTriviaEntry([
      ["uid-z", { answeredAt: 100 }],
      ["uid-a", { answeredAt: 100 }],
      ["uid-m", { answeredAt: 50 }],
    ]);
    assert.equal(fastest, "uid-m");
  });

  it("même answeredAt → uid lexicographique", () => {
    const fastest = pickFastestTriviaEntry([
      ["uid-z", { answeredAt: 100 }],
      ["uid-a", { answeredAt: 100 }],
    ]);
    assert.equal(fastest, "uid-a");
  });
});

describe("isValidTriviaAnswerIndex — alignement SQL", () => {
  const base = {
    correctIndex: 1,
    correctAnswer: "B",
    matchScores: {},
    answers: {
      int: { answerIndex: 1, answeredAt: 10 },
      str: { answerIndex: "01", answeredAt: 20 },
      dec: { answerIndex: 1.5, answeredAt: 30 },
      nul: { answerIndex: null, answeredAt: 40 },
      absent: { answeredAt: 50 },
      out: { answerIndex: 9, answeredAt: 60 },
    },
  };

  it("answerIndex entier → compté", () => {
    const r = scoreTriviaRoundFromAnswers(base);
    assert.deepEqual(r.lastRound.correctPlayers, ["int"]);
    assert.equal(r.matchScores.int, 15);
  });

  it("answerIndex chaîne / décimal / null / absent → ignorés (0 pt)", () => {
    const r = scoreTriviaRoundFromAnswers(base);
    assert.equal(r.matchScores.str, undefined);
    assert.equal(r.matchScores.dec, undefined);
    assert.equal(r.matchScores.nul, undefined);
    assert.equal(r.matchScores.absent, undefined);
  });

  it("answerIndex hors plage → ignoré", () => {
    const r = scoreTriviaRoundFromAnswers(base);
    assert.equal(r.matchScores.out, undefined);
  });

  it("isValidTriviaAnswerIndex unitaire", () => {
    assert.equal(isValidTriviaAnswerIndex(0), true);
    assert.equal(isValidTriviaAnswerIndex("1"), false);
    assert.equal(isValidTriviaAnswerIndex(1.1), false);
    assert.equal(isValidTriviaAnswerIndex(null), false);
  });
});

describe("sortCorrectEntriesForReveal — ordre correctPlayers", () => {
  it("answeredAt ASC puis uid ASC", () => {
    const sorted = sortCorrectEntriesForReveal([
      ["b", { answerIndex: 1, answeredAt: 200 }],
      ["a", { answerIndex: 1, answeredAt: 100 }],
      ["c", { answerIndex: 1, answeredAt: 100 }],
    ]);
    assert.deepEqual(sorted.map(([k]) => k), ["a", "c", "b"]);
  });
});
