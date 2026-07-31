import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateTriviaRevealRequest,
  mapTriviaRevealRpcError,
  triviaRevealErrorCode,
} from "../js/core/triviaRevealErrors.js";
import { createTriviaRunId } from "../js/core/triviaRunId.js";

describe("validateTriviaRevealRequest — anti-stale client", () => {
  it("refuse sans runId", () => {
    const out = validateTriviaRevealRequest({ phase: "question", questionIdx: 0 });
    assert.equal(out.ok, false);
    assert.equal(out.code, "TRIVIA_RUN_REQUIRED");
  });

  it("refuse hors phase question", () => {
    const out = validateTriviaRevealRequest({
      phase: "reveal",
      runId: createTriviaRunId(),
      questionIdx: 0,
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, "TRIVIA_INVALID_PHASE");
  });

  it("accepte une manche question valide", () => {
    const runId = createTriviaRunId();
    const out = validateTriviaRevealRequest({
      phase: "question",
      runId,
      questionIdx: 2,
    });
    assert.equal(out.ok, true);
    assert.equal(out.runId, runId);
    assert.equal(out.questionIdx, 2);
  });
});

describe("mapTriviaRevealRpcError", () => {
  it("mappe TRIVIA_STALE_RUN", () => {
    const err = mapTriviaRevealRpcError(new Error("TRIVIA_STALE_RUN"));
    assert.equal(triviaRevealErrorCode(err), "TRIVIA_STALE_RUN");
    assert.match(err.message, /autre partie/i);
  });

  it("laisse passer les erreurs inconnues", () => {
    const raw = new Error("network");
    assert.equal(mapTriviaRevealRpcError(raw), raw);
  });
});

describe("runId — nouvelle partie replay", () => {
  it("createTriviaRunId produit des ids distincts", () => {
    const a = createTriviaRunId();
    const b = createTriviaRunId();
    assert.notEqual(a, b);
    assert.ok(String(a).length > 8);
  });
});
