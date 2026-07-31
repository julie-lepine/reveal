const TRIVIA_REVEAL_ERROR_MESSAGES = {
  TRIVIA_STALE_RUN:
    "Cette manche appartient à une autre partie. Recharge la session.",
  TRIVIA_STALE_QUESTION: "Question déjà passée ou pas encore active.",
  TRIVIA_INVALID_PHASE: "Impossible de révéler dans cette phase.",
  TRIVIA_INVALID_STATE: "État Trivia invalide côté serveur.",
  TRIVIA_RUN_REQUIRED: "Partie Trivia non initialisée (runId manquant).",
};

export function triviaRevealErrorCode(err) {
  if (err?.code && TRIVIA_REVEAL_ERROR_MESSAGES[err.code]) {
    return err.code;
  }
  const msg = String(err?.message || err || "");
  for (const code of Object.keys(TRIVIA_REVEAL_ERROR_MESSAGES)) {
    if (msg.includes(code)) return code;
  }
  return null;
}

export function mapTriviaRevealRpcError(err) {
  const code = triviaRevealErrorCode(err);
  if (!code) return err;
  const mapped = new Error(TRIVIA_REVEAL_ERROR_MESSAGES[code]);
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
