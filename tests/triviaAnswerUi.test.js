/**
 * BUG-TRIVIA-01C - sélection UI, waitingMessage, pending après échec.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveLocalTriviaAnswerIndex,
  resolveConfirmedTriviaAnswerIndex,
  nextPendingAnswerAfterCommit,
  buildTriviaAnswerWaitingMessage,
} from "../js/core/triviaAnswerUi.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("triviaAnswerUi - sélection vs remote", () => {
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

  it("confirmed ignore le pending", () => {
    assert.equal(
      resolveConfirmedTriviaAnswerIndex({
        answers: {},
        localName: "Alice",
        localUid: "uid-a",
      }),
      null
    );
    assert.equal(
      resolveConfirmedTriviaAnswerIndex({
        answers: { Alice: { answerIndex: 2 } },
        localName: "Alice",
        localUid: "uid-a",
      }),
      2
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

describe("triviaAnswerUi - waitingMessage (01C)", () => {
  it("phase hors question → chaîne vide", () => {
    assert.equal(
      buildTriviaAnswerWaitingMessage({
        phase: "reveal",
        confirmedIndex: 1,
        allAnswersIn: true,
      }),
      ""
    );
  });

  it("envoi en cours", () => {
    assert.equal(
      buildTriviaAnswerWaitingMessage({
        phase: "question",
        answerCommitInFlight: true,
        pendingAnswerIndex: 1,
        answerCommitFailed: true,
      }),
      "Envoi de ta réponse…"
    );
  });

  it("échec + pending → message d'échec, jamais « enregistrée »", () => {
    const msg = buildTriviaAnswerWaitingMessage({
      phase: "question",
      pendingAnswerIndex: 2,
      answerCommitFailed: true,
      confirmedIndex: null,
    });
    assert.match(msg, /Envoi échoué/i);
    assert.equal(msg.includes("Réponse enregistrée"), false);
  });

  it("pending sans distant ni échec → post-succès / vérif, pas « enregistrée »", () => {
    const msg = buildTriviaAnswerWaitingMessage({
      phase: "question",
      pendingAnswerIndex: 0,
      confirmedIndex: null,
      answerCommitFailed: false,
      answerCommitInFlight: false,
    });
    assert.equal(msg.includes("Réponse enregistrée"), false);
    assert.match(msg, /Réponse envoyée/);
    assert.match(msg, /v[eé]rification/i);
    assert.equal(/appuie à nouveau|sélectionnée/i.test(msg), false);
  });

  it("pending + échec ≠ message post-succès", () => {
    const failed = buildTriviaAnswerWaitingMessage({
      phase: "question",
      pendingAnswerIndex: 1,
      confirmedIndex: null,
      answerCommitFailed: true,
      answerCommitInFlight: false,
    });
    assert.match(failed, /Envoi échoué/);
    assert.equal(failed.includes("Réponse envoyée"), false);
  });

  it("confirmé distant, autres manquants → enregistrée / en attente", () => {
    const msg = buildTriviaAnswerWaitingMessage({
      phase: "question",
      confirmedIndex: 1,
      allAnswersIn: false,
      pendingAnswerIndex: null,
    });
    assert.match(msg, /Réponse enregistrée/);
    assert.match(msg, /en attente/i);
  });

  it("confirmé + allAnswersIn → révélation", () => {
    assert.match(
      buildTriviaAnswerWaitingMessage({
        phase: "question",
        confirmedIndex: 0,
        allAnswersIn: true,
      }),
      /Révélation en cours/
    );
  });

  it("échec + pending n'est pas traité comme confirmé", () => {
    const msg = buildTriviaAnswerWaitingMessage({
      phase: "question",
      pendingAnswerIndex: 3,
      confirmedIndex: null,
      answerCommitFailed: true,
      allAnswersIn: true,
    });
    assert.match(msg, /Envoi échoué/);
    assert.equal(msg.includes("Tout le monde a répondu"), false);
    assert.equal(msg.includes("Réponse enregistrée"), false);
  });
});

describe("triviaAnswerUi - contrats source click handler", () => {
  it("catch n’efface plus pending ; alerte + mapper answer + nextPending", () => {
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
    assert.match(block, /mapTriviaAnswerRpcError/);
    assert.equal(block.includes("mapTriviaRevealRpcError"), false);
    assert.equal(block.includes("pendingAnswerIndex = null"), false);
    assert.match(block, /answerCommitFailed = true/);
  });

  it("myAnswerIndex passe par resolveLocal ; confirmation via helper dédié", () => {
    const src = readFileSync(join(ROOT, "js/games/trivia.js"), "utf8");
    assert.match(src, /resolveLocalTriviaAnswerIndex/);
    assert.match(src, /resolveConfirmedTriviaAnswerIndex/);
    assert.match(src, /buildTriviaAnswerWaitingMessage/);
    assert.match(src, /getSupabaseUserId/);
  });
});
