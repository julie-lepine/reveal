const TRIVIA_REVEAL_ERROR_MESSAGES = {
  TRIVIA_STALE_RUN:
    "Cette manche appartient à une autre partie. Recharge la session.",
  TRIVIA_STALE_QUESTION: "Question déjà passée ou pas encore active.",
  TRIVIA_INVALID_PHASE: "Impossible de révéler dans cette phase.",
  TRIVIA_INVALID_STATE: "État Trivia invalide côté serveur.",
  TRIVIA_RUN_REQUIRED: "Partie Trivia non initialisée (runId manquant).",
  TRIVIA_RPC_NOT_DEPLOYED:
    "Action Trivia indisponible : migrations SQL 01B / 01B-bis non appliquées sur Supabase. Exécute les scripts trivia puis relance une partie.",
};

/** Messages joueur — soumission de réponse (jamais de vocabulaire « révéler » / ops). */
const TRIVIA_ANSWER_ERROR_MESSAGES = {
  TRIVIA_STALE_RUN:
    "La partie n'est plus disponible. Reviens au lobby puis réessaie.",
  TRIVIA_STALE_QUESTION:
    "Cette question est déjà terminée. Ta réponse n'a pas pu être enregistrée.",
  TRIVIA_INVALID_PHASE:
    "La révélation a déjà commencé. Ta réponse n'a pas pu être enregistrée.",
  TRIVIA_INVALID_STATE:
    "Cette réponse n'est pas valide. Choisis-en une autre.",
  TRIVIA_RUN_REQUIRED:
    "La partie n'est plus disponible. Reviens au lobby puis réessaie.",
  TRIVIA_RPC_NOT_DEPLOYED:
    "Impossible d'enregistrer ta réponse pour le moment. Réessaie.",
  TRIVIA_SESSION_GONE:
    "La partie n'est plus disponible. Reviens au lobby puis réessaie.",
  TRIVIA_NOT_ALLOWED:
    "Tu n'es plus dans cette partie. Reviens au lobby puis réessaie.",
  TRIVIA_ANSWER_UNAVAILABLE:
    "Impossible d'enregistrer ta réponse pour le moment. Réessaie.",
  TRIVIA_ANSWER_UNKNOWN:
    "Impossible d'enregistrer ta réponse. Réessaie.",
};

const KNOWN_TRIVIA_RPC_CODES = new Set([
  ...Object.keys(TRIVIA_REVEAL_ERROR_MESSAGES),
  ...Object.keys(TRIVIA_ANSWER_ERROR_MESSAGES),
]);

export function triviaRevealErrorCode(err) {
  if (err?.code && KNOWN_TRIVIA_RPC_CODES.has(err.code)) {
    return err.code;
  }
  const msg = String(err?.message || err || "");
  if (
    msg.includes("Could not find the function") &&
    (msg.includes("reveal_trivia_round") || msg.includes("submit_trivia_answer"))
  ) {
    return "TRIVIA_RPC_NOT_DEPLOYED";
  }
  for (const code of KNOWN_TRIVIA_RPC_CODES) {
    if (msg.includes(code)) return code;
  }
  if (/session de jeu introuvable|lobby.*(expir|introuvable)|partie.*(plus disponible|expir)/i.test(msg)) {
    return "TRIVIA_SESSION_GONE";
  }
  if (
    /authentification requise|not a (lobby )?member|NOT_ALLOWED|non autoris|pas (un )?membre/i.test(
      msg
    )
  ) {
    return "TRIVIA_NOT_ALLOWED";
  }
  return null;
}

function mapTriviaCodedError(err, messages) {
  const code = triviaRevealErrorCode(err);
  if (!code || !messages[code]) return null;
  const mapped = new Error(messages[code]);
  mapped.code = code;
  mapped.cause = err;
  return mapped;
}

export function mapTriviaRevealRpcError(err) {
  return mapTriviaCodedError(err, TRIVIA_REVEAL_ERROR_MESSAGES) || err;
}

/**
 * Mapper dédié soumission de réponse (BUG-TRIVIA-01C).
 * Toujours un message joueur — jamais de détail migration / « révéler ».
 */
export function mapTriviaAnswerRpcError(err) {
  const coded = mapTriviaCodedError(err, TRIVIA_ANSWER_ERROR_MESSAGES);
  if (coded) return coded;

  const msg = String(err?.message || err || "").toLowerCase();
  const looksNetwork =
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("synchronisation trop longue") ||
    err?.name === "AbortError" ||
    err?.name === "TypeError";

  const code = looksNetwork ? "TRIVIA_ANSWER_UNAVAILABLE" : "TRIVIA_ANSWER_UNKNOWN";
  const mapped = new Error(TRIVIA_ANSWER_ERROR_MESSAGES[code]);
  mapped.code = code;
  mapped.cause = err;
  return mapped;
}

export function validateTriviaRevealRequest(session) {
  if (session?.phase !== "question") {
    return { ok: false, code: "TRIVIA_INVALID_PHASE" };
  }
  if (!session?.runId) {
    return { ok: false, code: "TRIVIA_RUN_REQUIRED" };
  }
  return {
    ok: true,
    runId: session.runId,
    questionIdx: session.questionIdx ?? 0,
  };
}

/** Même contrat stale run/question que reveal (01B-bis). */
export function validateTriviaAnswerRequest(session) {
  return validateTriviaRevealRequest(session);
}
