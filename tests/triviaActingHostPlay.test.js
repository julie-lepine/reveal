import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickTriviaPlayFields,
  buildTriviaRevealExplicitPatch,
  buildTriviaNextQuestionExplicitPatch,
  buildTriviaFinalExplicitPatch,
  TRIVIA_PLAY_FORBIDDEN_KEYS,
} from "../js/core/triviaPlayPatch.js";
import {
  validateTriviaActingHostPlayPatch,
  validateActingHostPlayPatch,
  mergeTriviaActingHostPlayShallow,
} from "../js/core/gameSessionSecurity.js";
import { mergeTriviaAnswersUid } from "../js/core/sessionMerge.js";
import { deriveTriviaCurrentQuestion } from "../js/core/triviaPlayPatch.js";

const Q0 = { id: "q0", correct: 0, answers: ["A0", "B0", "C0", "D0"], theme: "t1" };
const Q1 = { id: "q1", correct: 1, answers: ["A1", "B1", "C1", "D1"], theme: "t1" };

const UID_A = "11111111-1111-1111-1111-111111111111";
const UID_B = "22222222-2222-2222-2222-222222222222";
const UID_C = "33333333-3333-3333-3333-333333333333";

function sampleRemote(overrides = {}) {
  return {
    phase: "question",
    questionIdx: 4,
    questionScored: false,
    matchScores: { [UID_A]: 10, [UID_B]: 5, [UID_C]: 0 },
    lastRound: null,
    answers: {
      [UID_A]: { answerIndex: 1, answeredAt: 100 },
      [UID_B]: { answerIndex: 0, answeredAt: 200 },
      [UID_C]: { answerIndex: 2, answeredAt: 300 },
    },
    deck: [{ id: "q1" }],
    ready: { [UID_A]: true },
    lobbyStarted: true,
    selectedThemeId: "random",
    questionCount: 5,
    currentQuestion: { id: "q5", correct: 1 },
    results: null,
    podiumApplied: false,
    ...overrides,
  };
}

describe("pickTriviaPlayFields - filtrage", () => {
  it("reveal ne contient aucune clé interdite", () => {
    const remote = sampleRemote({
      phase: "reveal",
      questionScored: true,
      lastRound: {
        correctIndex: 1,
        correctPlayers: [UID_A],
        fastestPlayer: UID_A,
        deltas: { [UID_A]: 15 },
      },
    });
    const explicit = buildTriviaRevealExplicitPatch({
      questionIdx: 4,
      questionScored: true,
      matchScores: { Alice: 10, Bob: 5, Carol: 0 },
      lastRound: remote.lastRound,
    });
    explicit.phase = "reveal";
    const out = pickTriviaPlayFields(remote, explicit);
    assert.equal(out.phase, "reveal");
    assert.equal(out.questionIdx, 4);
    assert.equal(out.questionScored, true);
    assert.ok(out.matchScores);
    assert.ok(out.lastRound);
    assert.equal("answers" in out, false);
    assert.equal("currentQuestion" in out, false);
    assert.equal("results" in out, false);
    assert.equal("deck" in out, false);
    for (const key of TRIVIA_PLAY_FORBIDDEN_KEYS) {
      assert.equal(key in out, false, `forbidden ${key}`);
    }
    assert.equal(validateActingHostPlayPatch(out).ok, true);
  });

  it("next ne contient aucun champ prep et pas matchScores", () => {
    const remote = sampleRemote({ phase: "reveal" });
    const explicit = buildTriviaNextQuestionExplicitPatch(3);
    const out = pickTriviaPlayFields(remote, explicit);
    assert.deepEqual(Object.keys(out).sort(), [
      "answers",
      "lastRound",
      "phase",
      "questionIdx",
      "questionPlayerUids",
      "questionScored",
    ]);
    assert.deepEqual(out.answers, {});
    assert.equal("matchScores" in out, false);
    assert.equal("deck" in out, false);
    assert.equal("ready" in out, false);
  });

  it("final ne contient pas results", () => {
    const remote = sampleRemote({ phase: "reveal", questionIdx: 4 });
    const explicit = buildTriviaFinalExplicitPatch();
    const out = pickTriviaPlayFields(remote, explicit);
    assert.deepEqual(out, { phase: "final", podiumApplied: true });
    assert.equal("results" in out, false);
  });

  it("rejette roundScored", () => {
    const remote = sampleRemote();
    assert.throws(
      () => pickTriviaPlayFields(remote, { phase: "reveal", roundScored: true }),
      /roundScored interdit/
    );
  });

  it("rejette un spread session avec champs prep", () => {
    const remote = sampleRemote();
    assert.throws(
      () =>
        pickTriviaPlayFields(remote, {
          phase: "reveal",
          questionScored: true,
          matchScores: remote.matchScores,
          lastRound: { correctIndex: 0 },
          deck: remote.deck,
        }),
      /champ interdit deck/
    );
  });
});

describe("validateTriviaActingHostPlayPatch - transitions serveur (miroir)", () => {
  const serverReveal = {
    phase: "question",
    questionIdx: 4,
    questionCount: 5,
    answers: { [UID_A]: {}, [UID_B]: {}, [UID_C]: {} },
  };

  it("acting host reveal : accepte question → reveal", () => {
    const patch = {
      phase: "reveal",
      questionIdx: 4,
      questionScored: true,
      matchScores: { [UID_A]: 10 },
      lastRound: { correctIndex: 1 },
    };
    assert.equal(validateTriviaActingHostPlayPatch(serverReveal, patch).ok, true);
  });

  it("acting host reveal : answers inchangés après merge shallow sans clé answers", () => {
    const patch = {
      phase: "reveal",
      questionIdx: 4,
      questionScored: true,
      matchScores: { [UID_A]: 10 },
      lastRound: { correctIndex: 1 },
    };
    const merged = mergeTriviaActingHostPlayShallow(serverReveal, patch);
    assert.equal(Object.keys(merged.answers).length, 3);
    assert.equal(merged.phase, "reveal");
    assert.equal(merged.questionScored, true);
    assert.ok(merged.lastRound);
  });

  it("acting host question suivante : reset answers et matchScores conservés", () => {
    const server = {
      phase: "reveal",
      questionIdx: 2,
      questionCount: 5,
      matchScores: { [UID_A]: 20, [UID_B]: 10 },
      answers: { [UID_A]: { answerIndex: 1 }, [UID_B]: { answerIndex: 0 } },
    };
    const patch = buildTriviaNextQuestionExplicitPatch(3);
    assert.equal(validateTriviaActingHostPlayPatch(server, patch).ok, true);
    const merged = mergeTriviaActingHostPlayShallow(server, patch);
    assert.deepEqual(merged.answers, {});
    assert.equal(merged.questionIdx, 3);
    assert.equal(merged.phase, "question");
    assert.equal(merged.questionScored, false);
    assert.equal(merged.lastRound, null);
    assert.deepEqual(merged.matchScores, server.matchScores);
  });

  it("refuse answers non vide", () => {
    const server = { phase: "reveal", questionIdx: 2, questionCount: 5 };
    const patch = {
      phase: "question",
      questionIdx: 3,
      questionScored: false,
      lastRound: null,
      answers: { [UID_A]: { answerIndex: 0 } },
    };
    const v = validateTriviaActingHostPlayPatch(server, patch);
    assert.equal(v.ok, false);
  });

  it("refuse reset depuis question", () => {
    const server = { phase: "question", questionIdx: 2, questionCount: 5 };
    const patch = buildTriviaNextQuestionExplicitPatch(3);
    const v = validateTriviaActingHostPlayPatch(server, patch);
    assert.equal(v.ok, false);
  });

  it("refuse reset sans incrément questionIdx", () => {
    const server = { phase: "reveal", questionIdx: 2, questionCount: 5 };
    const patch = {
      phase: "question",
      questionIdx: 2,
      questionScored: false,
      lastRound: null,
      answers: {},
    };
    const v = validateTriviaActingHostPlayPatch(server, patch);
    assert.equal(v.ok, false);
  });

  it("refuse reset vers final", () => {
    const server = { phase: "reveal", questionIdx: 4, questionCount: 5 };
    const patch = {
      phase: "final",
      questionIdx: 5,
      answers: {},
    };
    const v = validateTriviaActingHostPlayPatch(server, patch);
    assert.equal(v.ok, false);
  });

  it("acting host final : phase final, podiumApplied, pas results", () => {
    const server = { phase: "reveal", questionIdx: 4, questionCount: 5 };
    const patch = buildTriviaFinalExplicitPatch();
    assert.equal(validateTriviaActingHostPlayPatch(server, patch).ok, true);
    assert.equal("results" in patch, false);
    const merged = mergeTriviaActingHostPlayShallow(server, patch);
    assert.equal(merged.phase, "final");
    assert.equal(merged.podiumApplied, true);
    assert.equal(merged.results, undefined);
  });

  it("refuse final si pas dernière question", () => {
    const server = { phase: "reveal", questionIdx: 2, questionCount: 5 };
    const patch = buildTriviaFinalExplicitPatch();
    assert.equal(validateTriviaActingHostPlayPatch(server, patch).ok, false);
  });
});

describe("hôte réel - merge profond answers (non atomicité complète)", () => {
  it("conserve une réponse serveur absente du patch reveal", () => {
    const curAnswers = {
      [UID_A]: { answerIndex: 1, answeredAt: 100 },
      [UID_B]: { answerIndex: 0, answeredAt: 200 },
      [UID_C]: { answerIndex: 2, answeredAt: 300 },
    };
    const incAnswers = {
      [UID_A]: { answerIndex: 1, answeredAt: 100 },
      [UID_B]: { answerIndex: 0, answeredAt: 200 },
    };
    const merged = mergeTriviaAnswersUid(curAnswers, incAnswers);
    assert.equal(Object.keys(merged).length, 3);
    assert.ok(merged[UID_C]);
  });

  it("pickTriviaPlayFields reveal n'inclut pas answers dans le patch distant", () => {
    const remote = sampleRemote();
    const explicit = buildTriviaRevealExplicitPatch({
      questionIdx: 4,
      questionScored: true,
      matchScores: {},
      lastRound: { correctIndex: 0 },
    });
    const out = pickTriviaPlayFields(remote, explicit);
    assert.equal("answers" in out, false);
  });
});

describe("deriveTriviaCurrentQuestion - ignore stale remote", () => {
  it("prend deck[questionIdx] quand currentQuestion remote est obsolète", () => {
    const deck = [Q0, Q1];
    assert.equal(deriveTriviaCurrentQuestion(deck, 1, Q0)?.id, "q1");
    assert.equal(deriveTriviaCurrentQuestion(deck, 1, Q0)?.answers?.[0], "A1");
  });
});

describe("buildTrivia*ExplicitPatch", () => {
  it("reveal patch contient uniquement les champs autorisés", () => {
    const patch = buildTriviaRevealExplicitPatch({
      questionIdx: 4,
      questionScored: true,
      matchScores: { a: 1 },
      lastRound: { correctIndex: 0 },
      answers: { x: 1 },
      deck: [],
    });
    assert.deepEqual(Object.keys(patch).sort(), [
      "lastRound",
      "matchScores",
      "phase",
      "questionIdx",
      "questionScored",
    ]);
  });
});
