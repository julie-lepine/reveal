/**
 * BUG-TRIVIA-01B-bis — sélection UI locale vs answers distantes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveLocalTriviaAnswerIndex,
  nextPendingAnswerAfterCommit,
} from "../js/core/triviaAnswerUi.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("triviaAnswerUi — sélection vs remote", () => {
  it("pending local visible avant confirmation distante", () => {
    assert.equal(
      resolveLocalTriviaAnswerIndex({
        pendingAnswerIndex: 2,
        answers: {},
        localName: "Alice",
        localUid: "uid-a",
      }),
      2
    );
  });

  it("réponse confirmée par pseudo", () => {
    assert.equal(
      resolveLocalTriviaAnswerIndex({
        pendingAnswerIndex: null,
        answers: { Alice: { answerIndex: 1, answeredAt: 1 } },
        localName: "Alice",
        localUid: "uid-a",
      }),
      1
    );
  });

  it("réponse confirmée par UID (sans pseudo dans la map)", () => {
    assert.equal(
      resolveLocalTriviaAnswerIndex({
        pendingAnswerIndex: null,
        answers: { "uid-a": { answerIndex: 3, answeredAt: 1 } },
        localName: "Alice",
        localUid: "uid-a",
      }),
      3
    );
  });

  it("pending prioritaire sur remote (envoi en cours)", () => {
    assert.equal(
      resolveLocalTriviaAnswerIndex({
        pendingAnswerIndex: 0,
        answers: { Alice: { answerIndex: 1 } },
        localName: "Alice",
        localUid: "uid-a",
      }),
      0
    );
  });

  it("erreur RPC : conserve pending (pas de désengagement silencieux)", () => {
    assert.equal(
      nextPendingAnswerAfterCommit({
        commitOk: false,
        pendingAnswerIndex: 2,
        confirmedIndex: null,
      }),
      2
    );
  });

  it("succès + remote confirmé : clear pending", () => {
    assert.equal(
      nextPendingAnswerAfterCommit({
        commitOk: true,
        pendingAnswerIndex: 2,
        confirmedIndex: 2,
      }),
      null
    );
  });

  it("succès sans remote mappé : garde pending (sélection visible)", () => {
    assert.equal(
      nextPendingAnswerAfterCommit({
        commitOk: true,
        pendingAnswerIndex: 2,
        confirmedIndex: null,
      }),
      2
    );
  });

  it("remote-only : pending local ≠ entrée dans answers partagées", () => {
    const answers = {};
    const selected = resolveLocalTriviaAnswerIndex({
      pendingAnswerIndex: 1,
      answers,
      localName: "Alice",
      localUid: "uid-a",
    });
    assert.equal(selected, 1);
    assert.equal(Object.keys(answers).length, 0);
  });
});

describe("triviaAnswerUi — contrats source click handler", () => {
  it("catch n’efface plus pending silencieusement ; alerte + nextPending", () => {
    const src = readFileSync(join(ROOT, "js/games/trivia.js"), "utf8");
    const start = src.indexOf('app.querySelectorAll("[data-trivia-answer]")');
    const end = src.indexOf('app.querySelector("#btn-trivia-force")', start);
    const block = src.slice(start, end);
    assert.match(block, /TRIVIA_ANSWER_CLICK/);
    assert.match(block, /TRIVIA_ANSWER_SUBMIT_START/);
    assert.match(block, /TRIVIA_ANSWER_RPC_SUCCESS/);
    assert.match(block, /TRIVIA_ANSWER_RPC_ERROR/);
    assert.match(block, /showAppAlert/);
    assert.match(block, /nextPendingAnswerAfterCommit/);
    assert.match(block, /mapTriviaRevealRpcError/);
    assert.equal(block.includes("pendingAnswerIndex = null"), false);
  });

  it("myAnswerIndex passe par resolveLocalTriviaAnswerIndex (UID)", () => {
    const src = readFileSync(join(ROOT, "js/games/trivia.js"), "utf8");
    assert.match(src, /resolveLocalTriviaAnswerIndex/);
    assert.match(src, /getSupabaseUserId/);
  });
});
