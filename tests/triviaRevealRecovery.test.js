import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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
