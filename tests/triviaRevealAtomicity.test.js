/**
 * BUG-TRIVIA-01B - contrats chemins MP reveal (pas de score client live).
 * Les verrous SQL réels sont prouvés par les scripts SQL rollback / runbook concurrence.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const triviaJs = readFileSync(join(ROOT, "js/games/trivia.js"), "utf8");
const sessionJs = readFileSync(join(ROOT, "js/core/triviaSession.js"), "utf8");
const rpcJs = readFileSync(join(ROOT, "js/core/gameSessionRpc.js"), "utf8");
const answerSql = readFileSync(
  join(ROOT, "supabase/game-sessions-trivia-01b-answer-auto-reveal.sql"),
  "utf8"
);
const revealSqlV1 = readFileSync(
  join(ROOT, "supabase/game-sessions-trivia-01b-reveal-round.sql"),
  "utf8"
);

describe("BUG-TRIVIA-01B - chemins MP sans score client", () => {
  it("goToReveal MP appelle commitRevealPlay, pas scoreRound", () => {
    const start = triviaJs.indexOf("async function goToReveal");
    const end = triviaJs.indexOf("async function forceReveal", start);
    const block = triviaJs.slice(start, end);
    assert.match(block, /mp && canActAsHost\(\)/);
    assert.match(block, /commitRevealPlay\(\)/);
    const mpBranchEnd = block.indexOf("else if (!mp)");
    assert.ok(mpBranchEnd > 0, "branche solo présente");
    const mpBranch = block.slice(0, mpBranchEnd);
    assert.equal(/\bscoreRound\b/.test(mpBranch), false);
    assert.match(block.slice(mpBranchEnd), /scoreRound/);
  });

  it("forceReveal MP délègue à goToReveal (même contrat)", () => {
    const start = triviaJs.indexOf("async function forceReveal");
    const end = triviaJs.indexOf("function localRevealFeedbackHtml", start);
    const block = triviaJs.slice(start, end);
    assert.match(block, /await goToReveal\(\)/);
    assert.match(block, /if \(!mp\) await fillMissingLocalAnswers/);
  });

  it("commitTriviaRevealPlay = RPC reveal uniquement", () => {
    const start = sessionJs.indexOf("export async function commitTriviaRevealPlay");
    const end = sessionJs.indexOf("export async function commitTriviaFinalPlay", start);
    const block = sessionJs.slice(start, end);
    assert.match(block, /rpcRevealTriviaRound/);
    assert.equal(block.includes("scoreTriviaRound"), false);
    assert.equal(block.includes("patchGameState"), false);
    assert.equal(block.includes("commitHostGamePlay"), false);
  });

  it("rpcRevealTriviaRound cible reveal_trivia_round", () => {
    assert.match(rpcJs, /reveal_trivia_round/);
    assert.match(rpcJs, /p_lobby_id:\s*lobbyId/);
    assert.match(rpcJs, /p_run_id:\s*runId/);
    assert.match(rpcJs, /p_question_idx:\s*questionIdx/);
  });

  it("scoreRound solo uniquement dans branche !mp de goToReveal", () => {
    const start = triviaJs.indexOf("async function goToReveal");
    const end = triviaJs.indexOf("async function forceReveal", start);
    const block = triviaJs.slice(start, end);
    assert.match(block, /else if \(!mp\)[\s\S]*scoreRound/);
  });
});

describe("BUG-TRIVIA-01B - SQL contrats atomiques (source)", () => {
  it("01B-bis : reveal_trivia_round et submit partagent trivia_apply_reveal_scoring", () => {
    assert.match(answerSql, /create or replace function public\.trivia_apply_reveal_scoring/);
    assert.match(
      answerSql,
      /create or replace function public\.reveal_trivia_round[\s\S]*trivia_apply_reveal_scoring\(v_trivia/
    );
    assert.match(
      answerSql,
      /trivia_all_expected_players_answered[\s\S]*trivia_apply_reveal_scoring/
    );
  });

  it("FOR UPDATE avant lecture answers / scoring (reveal 01B-bis)", () => {
    const fnStart = answerSql.indexOf(
      "create or replace function public.reveal_trivia_round"
    );
    const fnEnd = answerSql.indexOf(
      "create or replace function public.submit_trivia_answer",
      fnStart
    );
    const fn = answerSql.slice(fnStart, fnEnd);
    const lockIdx = fn.indexOf("for update");
    const scoreIdx = fn.indexOf("trivia_apply_reveal_scoring");
    assert.ok(lockIdx > 0, "FOR UPDATE présent");
    assert.ok(scoreIdx > lockIdx, "scoring après verrou");
  });

  it("submit_trivia_answer : FOR UPDATE avant mutation answers", () => {
    const fnStart = answerSql.indexOf(
      "create or replace function public.submit_trivia_answer"
    );
    const fn = answerSql.slice(fnStart);
    const lockIdx = fn.indexOf("for update");
    const setAns = fn.indexOf("jsonb_set(v_answers");
    assert.ok(lockIdx > 0);
    assert.ok(setAns > lockIdx);
  });

  it("idempotence reveal : return early si déjà scored", () => {
    assert.match(
      answerSql,
      /v_phase = 'reveal'[\s\S]*questionScored[\s\S]*return v_row/
    );
  });

  it("réponse après reveal → TRIVIA_INVALID_PHASE", () => {
    assert.match(
      answerSql,
      /v_phase = 'reveal'[\s\S]*raise exception 'TRIVIA_INVALID_PHASE'/
    );
  });

  it("fichier 01B initial documente aussi FOR UPDATE (baseline)", () => {
    assert.match(revealSqlV1, /for update/i);
  });
});

describe("BUG-TRIVIA-01B - UX late answer / reset pending", () => {
  it("changement de phase clearAnswerCommitUi (pending + failed)", () => {
    assert.match(triviaJs, /clearAnswerCommitUi\(\)/);
    assert.match(
      triviaJs,
      /prevPhase !== phase[\s\S]*clearAnswerCommitUi/
    );
  });

  it("click handler mappe via mapTriviaAnswerRpcError (pas merge answers local)", () => {
    const start = triviaJs.indexOf('app.querySelectorAll("[data-trivia-answer]")');
    const end = triviaJs.indexOf('app.querySelector("#btn-trivia-force")', start);
    const block = triviaJs.slice(start, end);
    assert.match(block, /mapTriviaAnswerRpcError/);
    assert.equal(block.includes("answers["), false);
    assert.equal(/saveStatePatch/.test(block), false);
  });
});

describe("BUG-TRIVIA-01B - buildTriviaRevealExplicitPatch hors live MP", () => {
  it("trivia.js live n'appelle pas buildTriviaRevealExplicitPatch", () => {
    assert.equal(triviaJs.includes("buildTriviaRevealExplicitPatch"), false);
  });

  it("commitTriviaRevealPlay n'utilise pas le patch explicite", () => {
    const start = sessionJs.indexOf("export async function commitTriviaRevealPlay");
    const end = sessionJs.indexOf("export async function commitTriviaFinalPlay", start);
    assert.equal(
      sessionJs.slice(start, end).includes("buildTriviaRevealExplicitPatch"),
      false
    );
  });
});
