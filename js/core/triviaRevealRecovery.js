import { triviaRevealErrorCode } from "./triviaRevealErrors.js";

/** Erreur RPC métier Trivia — pas de recovery timeout. */
export function isTriviaRevealBusinessError(err) {
  return Boolean(triviaRevealErrorCode(err));
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
