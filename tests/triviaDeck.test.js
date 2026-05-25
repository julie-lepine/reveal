import test from "node:test";
import assert from "node:assert/strict";

import { prepareTriviaDeck, TRIVIA_RANDOM_THEME_ID } from "../data/trivia.js";

function makeRandomSequence(values) {
  let idx = 0;
  return () => {
    const value = values[idx % values.length];
    idx += 1;
    return value;
  };
}

test("prepareTriviaDeck blocks launch when pool is too small", () => {
  const bank = [
    {
      id: "cinema-1",
      theme: "cinema",
      question: "Q1",
      answers: ["A", "B", "C", "D"],
      correct: 0,
      difficulty: "easy",
    },
  ];

  const result = prepareTriviaDeck("cinema", 2, bank);
  assert.equal(result.ok, false);
  assert.equal(result.missing, 1);
  assert.equal(result.poolSize, 1);
});

test("prepareTriviaDeck builds a unique shuffled deck with preserved correct answers", () => {
  const bank = [
    {
      id: "q-1",
      theme: "cinema",
      question: "Q1",
      answers: ["Good", "Bad", "Ugly", "Wild"],
      correct: 0,
      difficulty: "easy",
    },
    {
      id: "q-2",
      theme: "music",
      question: "Q2",
      answers: ["Blue", "Red", "Green", "Gold"],
      correct: 2,
      difficulty: "medium",
    },
    {
      id: "q-2",
      theme: "music",
      question: "Q2 duplicate",
      answers: ["Blue", "Red", "Green", "Gold"],
      correct: 2,
      difficulty: "medium",
    },
    {
      id: "q-3",
      theme: "sport",
      question: "Q3",
      answers: ["One", "Two", "Three", "Four"],
      correct: 3,
      difficulty: "hard",
    },
  ];

  const random = makeRandomSequence([0.15, 0.8, 0.35, 0.6, 0.25, 0.45, 0.7, 0.05]);
  const result = prepareTriviaDeck(TRIVIA_RANDOM_THEME_ID, 3, bank, random);

  assert.equal(result.ok, true);
  assert.equal(result.deck.length, 3);
  assert.equal(new Set(result.deck.map((question) => question.id)).size, 3);

  const originals = new Map(bank.map((question) => [question.id, question]));
  result.deck.forEach((question) => {
    assert.equal(question.answers.length, 4);
    assert.ok(question.correct >= 0 && question.correct < question.answers.length);
    const original = originals.get(question.id);
    assert.equal(question.answers[question.correct], original.answers[original.correct]);
  });
});
