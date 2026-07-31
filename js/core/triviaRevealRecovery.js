import { triviaRevealErrorCode } from "./triviaRevealErrors.js";

const TRIVIA_SOFT_ANSWER_CODES = new Set([
  "TRIVIA_ANSWER_UNAVAILABLE",
  "TRIVIA_ANSWER_UNKNOWN",
]);

/** Erreur RPC métier Trivia — pas de recovery timeout. */
export function isTriviaRevealBusinessError(err) {
  const code = triviaRevealErrorCode(err);
  return Boolean(code) && !TRIVIA_SOFT_ANSWER_CODES.has(code);
}

/**
 * Erreur réseau / timeout / réponse RPC invalide (hors codes métier).
 * @param {unknown} err
 */
export function isTriviaRevealNetworkError(err) {
  if (!err || isTriviaRevealBusinessError(err)) return false;
  const name = String(err?.name || "");
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    name === "AbortError" ||
    name === "TypeError" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("synchronisation trop longue")
  );
}

/**
 * Évalue si l'état distant confirme un reveal réussi (recovery post-timeout).
 * @param {object|null|undefined} remoteTrivia
 * @param {{ runId: string, questionIdx: number }} expected
 */
export function evaluateTriviaRevealRecovery(remoteTrivia, expected) {
  if (!remoteTrivia || typeof remoteTrivia !== "object") {
    return { recovered: false, reason: "no_state" };
  }
  const remoteRunId = remoteTrivia.runId || null;
  if (!remoteRunId || remoteRunId !== expected.runId) {
    return { recovered: false, reason: "stale_run" };
  }
  const remoteIdx = remoteTrivia.questionIdx ?? 0;
  if (remoteIdx !== expected.questionIdx) {
    return { recovered: false, reason: "stale_question" };
  }
  const phase = remoteTrivia.phase || null;
  const scored = Boolean(remoteTrivia.questionScored);
  if (scored && (phase === "reveal" || phase === "final")) {
    return { recovered: true, reason: "revealed" };
  }
  return { recovered: false, reason: "not_revealed" };
}

/**
 * Recovery post-timeout pour submit_trivia_answer.
 * @param {object|null|undefined} remoteTrivia
 * @param {{ runId: string, questionIdx: number, answerIndex: number, localUid: string }} expected
 */
export function evaluateTriviaAnswerRecovery(remoteTrivia, expected) {
  if (!remoteTrivia || typeof remoteTrivia !== "object") {
    return { recovered: false, reason: "no_state" };
  }
  const remoteRunId = remoteTrivia.runId || null;
  if (!remoteRunId || remoteRunId !== expected.runId) {
    return { recovered: false, reason: "stale_run" };
  }
  const remoteIdx = remoteTrivia.questionIdx ?? 0;
  if (remoteIdx !== expected.questionIdx) {
    return { recovered: false, reason: "stale_question" };
  }

  const phase = remoteTrivia.phase || null;
  const scored = Boolean(remoteTrivia.questionScored);
  const uid = expected.localUid;
  const remoteAnswer = uid ? remoteTrivia.answers?.[uid] : null;
  const remoteIdxMatch =
    remoteAnswer != null &&
    Number.isInteger(remoteAnswer.answerIndex) &&
    remoteAnswer.answerIndex === expected.answerIndex;

  if (remoteIdxMatch && phase === "question" && !scored) {
    return { recovered: true, reason: "answer_recorded" };
  }
  if (scored && (phase === "reveal" || phase === "final") && remoteTrivia.lastRound) {
    return { recovered: true, reason: "auto_revealed" };
  }
  if (remoteIdxMatch && scored && (phase === "reveal" || phase === "final")) {
    return { recovered: true, reason: "auto_revealed" };
  }
  return { recovered: false, reason: "answer_missing" };
}
