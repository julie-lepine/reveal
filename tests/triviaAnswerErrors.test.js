/**
 * BUG-TRIVIA-01C - mapper erreurs soumission vs révélation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapTriviaAnswerRpcError,
  mapTriviaRevealRpcError,
  triviaRevealErrorCode,
} from "../js/core/triviaRevealErrors.js";

describe("mapTriviaAnswerRpcError - 01C", () => {
  it("TRIVIA_INVALID_PHASE : révélation déjà commencée, pas de « réessaie »", () => {
    const err = mapTriviaAnswerRpcError(new Error("TRIVIA_INVALID_PHASE"));
    assert.equal(err.code, "TRIVIA_INVALID_PHASE");
    assert.match(err.message, /révélation a déjà commencé/i);
    assert.match(err.message, /n'a pas pu être enregistrée/i);
    assert.equal(/r[eé]essaie/i.test(err.message), false);
  });

  it("TRIVIA_STALE_QUESTION : question terminée, pas de retry", () => {
    const err = mapTriviaAnswerRpcError(new Error("TRIVIA_STALE_QUESTION"));
    assert.match(err.message, /déjà terminée/i);
    assert.equal(/r[eé]essaie/i.test(err.message), false);
  });

  it("TRIVIA_RPC_NOT_DEPLOYED : pas de vocabulaire technique / migration", () => {
    const err = mapTriviaAnswerRpcError(
      new Error(
        "Could not find the function public.submit_trivia_answer(p_lobby_id, p_run_id, p_question_idx, p_answer_index, p_answered_at) in the schema cache"
      )
    );
    assert.equal(triviaRevealErrorCode(err), "TRIVIA_RPC_NOT_DEPLOYED");
    assert.match(err.message, /Impossible d'enregistrer/i);
    assert.equal(/migration|01B|SQL|Supabase|schema cache/i.test(err.message), false);
  });

  it("fallback demande de réessayer", () => {
    const err = mapTriviaAnswerRpcError(new Error("something weird"));
    assert.match(err.message, /Impossible d'enregistrer ta réponse/i);
    assert.match(err.message, /R[eé]essaie/);
  });

  it("réseau → indisponibilité joueur", () => {
    const err = mapTriviaAnswerRpcError(new TypeError("Failed to fetch"));
    assert.equal(err.code, "TRIVIA_ANSWER_UNAVAILABLE");
    assert.match(err.message, /pour le moment/i);
  });

  it("session introuvable", () => {
    const err = mapTriviaAnswerRpcError(new Error("Session de jeu introuvable."));
    assert.equal(err.code, "TRIVIA_SESSION_GONE");
    assert.match(err.message, /plus disponible/i);
  });

  it("réponse invalide (INVALID_STATE)", () => {
    const err = mapTriviaAnswerRpcError(new Error("TRIVIA_INVALID_STATE"));
    assert.match(err.message, /pas valide/i);
  });

  it("aucun message answer (hors phase) ne contient « révéler » comme action", () => {
    const codes = [
      "TRIVIA_STALE_RUN",
      "TRIVIA_STALE_QUESTION",
      "TRIVIA_INVALID_STATE",
      "TRIVIA_RUN_REQUIRED",
      "TRIVIA_RPC_NOT_DEPLOYED",
    ];
    for (const code of codes) {
      const err = mapTriviaAnswerRpcError(new Error(code));
      assert.equal(/r[eé]v[eé]ler/i.test(err.message), false, code);
    }
  });
});

describe("mapTriviaRevealRpcError - inchangé pour reveal", () => {
  it("conserve le vocabulaire révélation pour INVALID_PHASE", () => {
    const err = mapTriviaRevealRpcError(new Error("TRIVIA_INVALID_PHASE"));
    assert.match(err.message, /r[eé]v[eé]l/i);
  });

  it("RPC absente reveal garde le détail ops (host/debug)", () => {
    const err = mapTriviaRevealRpcError(
      new Error(
        "Could not find the function public.reveal_trivia_round(p_lobby_id, p_question_idx, p_run_id) in the schema cache"
      )
    );
    assert.equal(triviaRevealErrorCode(err), "TRIVIA_RPC_NOT_DEPLOYED");
    assert.match(err.message, /01B/i);
  });
});
