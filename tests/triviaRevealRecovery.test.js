import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTriviaAnswerRecovery,
  evaluateTriviaRevealRecovery,
  isTriviaRevealBusinessError,
  isTriviaRevealNetworkError,
} from "../js/core/triviaRevealRecovery.js";
import { mapTriviaRevealRpcError } from "../js/core/triviaRevealErrors.js";

describe("isTriviaRevealNetworkError", () => {
  it("timeout réseau = true", () => {
    assert.equal(isTriviaRevealNetworkError(new Error("fetch failed")), true);
    assert.equal(isTriviaRevealNetworkError(new TypeError("Failed to fetch")), true);
  });

  it("erreur métier = false", () => {
    const biz = mapTriviaRevealRpcError(new Error("TRIVIA_STALE_RUN"));
    assert.equal(isTriviaRevealBusinessError(biz), true);
    assert.equal(isTriviaRevealNetworkError(biz), false);
  });

  it("codes soft answer ne sont pas business (recovery réseau reste possible sur l'erreur d'origine)", () => {
    const softUnavailable = Object.assign(new Error("Impossible"), {
      code: "TRIVIA_ANSWER_UNAVAILABLE",
    });
    const softUnknown = Object.assign(new Error("Impossible"), {
      code: "TRIVIA_ANSWER_UNKNOWN",
    });
    assert.equal(isTriviaRevealBusinessError(softUnavailable), false);
    assert.equal(isTriviaRevealBusinessError(softUnknown), false);
    assert.equal(isTriviaRevealNetworkError(new TypeError("Failed to fetch")), true);
  });
});

describe("evaluateTriviaRevealRecovery", () => {
  const expected = { runId: "run-a", questionIdx: 2 };

  it("succès serveur perdu : phase reveal scored", () => {
    const out = evaluateTriviaRevealRecovery(
      { runId: "run-a", questionIdx: 2, phase: "reveal", questionScored: true },
      expected
    );
    assert.equal(out.recovered, true);
  });

  it("timeout sans succès : phase question", () => {
    const out = evaluateTriviaRevealRecovery(
      { runId: "run-a", questionIdx: 2, phase: "question", questionScored: false },
      expected
    );
    assert.equal(out.recovered, false);
    assert.equal(out.reason, "not_revealed");
  });

  it("nouveau run pendant timeout", () => {
    const out = evaluateTriviaRevealRecovery(
      { runId: "run-b", questionIdx: 2, phase: "reveal", questionScored: true },
      expected
    );
    assert.equal(out.recovered, false);
    assert.equal(out.reason, "stale_run");
  });
});

describe("evaluateTriviaAnswerRecovery", () => {
  const base = {
    runId: "run-a",
    questionIdx: 1,
    answerIndex: 2,
    localUid: "uid-local",
  };

  it("timeout : réponse enregistrée, question ouverte", () => {
    const out = evaluateTriviaAnswerRecovery(
      {
        runId: "run-a",
        questionIdx: 1,
        phase: "question",
        questionScored: false,
        answers: { "uid-local": { answerIndex: 2, answeredAt: 100 } },
      },
      base
    );
    assert.equal(out.recovered, true);
    assert.equal(out.reason, "answer_recorded");
  });

  it("timeout : auto-reveal déjà fait", () => {
    const out = evaluateTriviaAnswerRecovery(
      {
        runId: "run-a",
        questionIdx: 1,
        phase: "reveal",
        questionScored: true,
        lastRound: { correctIndex: 1 },
        answers: { "uid-local": { answerIndex: 2, answeredAt: 100 } },
      },
      base
    );
    assert.equal(out.recovered, true);
    assert.equal(out.reason, "auto_revealed");
  });

  it("timeout : réponse absente", () => {
    const out = evaluateTriviaAnswerRecovery(
      {
        runId: "run-a",
        questionIdx: 1,
        phase: "question",
        questionScored: false,
        answers: {},
      },
      base
    );
    assert.equal(out.recovered, false);
    assert.equal(out.reason, "answer_missing");
  });
});
