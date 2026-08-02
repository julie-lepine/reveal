import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dehydrateConsensusDeck,
  rehydrateConsensusDeck,
  dehydrateTriviaDeck,
  rehydrateTriviaDeck,
  dehydrateDilemmaDeck,
  rehydrateDilemmaDeck,
} from "../js/core/deckCodec.js";
import { TRIVIA_QUESTIONS } from "../data/trivia.js";
import { CONSENSUS_QUESTIONS } from "../data/consensus.js";

describe("deckCodec - trivia (réponses mélangées)", () => {
  const base = TRIVIA_QUESTIONS[0];
  // Simule un deck de partie : réponses mélangées + correct remappé.
  const order = [base.answers[2], base.answers[0], base.answers[3], base.answers[1]];
  const shuffled = {
    ...base,
    answers: order,
    correct: order.indexOf(base.answers[base.correct]),
  };

  it("réhydrate à l'identique (ordre des réponses + correct)", () => {
    const hydrated = rehydrateTriviaDeck(dehydrateTriviaDeck([shuffled]));
    assert.deepEqual(hydrated[0].answers, shuffled.answers);
    assert.equal(hydrated[0].correct, shuffled.correct);
    assert.equal(hydrated[0].id, shuffled.id);
    assert.equal(hydrated[0].question, base.question);
  });

  it("déshydrate sans embarquer les chaînes de réponses", () => {
    const dry = dehydrateTriviaDeck([shuffled]);
    assert.equal(dry[0].r, base.id);
    assert.ok(Array.isArray(dry[0].a));
    assert.equal(dry[0].k, shuffled.correct);
    assert.equal(dry[0].answers, undefined);
    assert.equal(dry[0].question, undefined);
  });

  it("retombe en inline si l'id est inconnu", () => {
    const orphan = { id: "zzz-unknown", question: "?", answers: ["a", "b"], correct: 0 };
    const dry = dehydrateTriviaDeck([orphan]);
    assert.deepEqual(dry[0], { c: orphan });
    assert.deepEqual(rehydrateTriviaDeck(dry)[0], orphan);
  });
});

describe("deckCodec - consensus", () => {
  it("réhydrate l'objet de banque par id", () => {
    const item = CONSENSUS_QUESTIONS[0];
    const dry = dehydrateConsensusDeck([item]);
    assert.equal(dry[0].r, String(item.id));
    assert.deepEqual(rehydrateConsensusDeck(dry)[0], item);
  });
});

describe("deckCodec - dilemma", () => {
  it("réf la banque par id et garde les customs en inline", () => {
    const bankItem = { id: "sleep-hot", optionA: "x", optionB: "y" };
    const custom = { id: "custom-123", optionA: "A", optionB: "B", author: "Alice", tier: "custom" };
    const dry = dehydrateDilemmaDeck([bankItem, custom]);
    assert.equal(dry[0].r, "sleep-hot");
    assert.deepEqual(dry[1], { c: custom });
    const back = rehydrateDilemmaDeck(dry);
    assert.equal(back[0].id, "sleep-hot");
    assert.deepEqual(back[1], custom);
  });
});

describe("deckCodec - robustesse", () => {
  it("legacy : un deck d'objets complets est renvoyé tel quel", () => {
    const legacy = [CONSENSUS_QUESTIONS[0]];
    assert.deepEqual(rehydrateConsensusDeck(legacy), legacy);
  });

  it("idempotent : re-déshydrater ne change rien", () => {
    const dry = dehydrateConsensusDeck([CONSENSUS_QUESTIONS[0]]);
    assert.deepEqual(dehydrateConsensusDeck(dry), dry);
  });

  it("null / non-array : passe-plat", () => {
    assert.equal(dehydrateTriviaDeck(null), null);
    assert.equal(rehydrateTriviaDeck(undefined), undefined);
  });
});
