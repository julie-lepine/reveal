/**
 * BUG-TRIVIA-01B-bis / 01C — sélection UI locale vs answers distantes (UID ou pseudo).
 * Ne pas écrire de réponse optimiste dans state.trivia.answers.
 */

/**
 * @param {{
 *   pendingAnswerIndex?: number|null,
 *   answers?: Record<string, { answerIndex?: number }>,
 *   localName?: string|null,
 *   localUid?: string|null,
 * }} input
 * @returns {number|null}
 */
export function resolveLocalTriviaAnswerIndex({
  pendingAnswerIndex = null,
  answers = {},
  localName = null,
  localUid = null,
} = {}) {
  if (Number.isInteger(pendingAnswerIndex)) return pendingAnswerIndex;
  if (localName && Number.isInteger(answers?.[localName]?.answerIndex)) {
    return answers[localName].answerIndex;
  }
  if (localUid && Number.isInteger(answers?.[localUid]?.answerIndex)) {
    return answers[localUid].answerIndex;
  }
  return null;
}

/**
 * Réponse réellement confirmée côté état distant (ignore le pending local).
 * @param {{
 *   answers?: Record<string, { answerIndex?: number }>,
 *   localName?: string|null,
 *   localUid?: string|null,
 * }} input
 * @returns {number|null}
 */
export function resolveConfirmedTriviaAnswerIndex({
  answers = {},
  localName = null,
  localUid = null,
} = {}) {
  return resolveLocalTriviaAnswerIndex({
    pendingAnswerIndex: null,
    answers,
    localName,
    localUid,
  });
}

/**
 * Après commit : ne retirer la sélection locale que si la réponse distante confirme,
 * ou si le commit a échoué on conserve le pending (sélection visible pour retry).
 *
 * @param {{
 *   commitOk: boolean,
 *   pendingAnswerIndex: number|null,
 *   confirmedIndex: number|null,
 * }} input
 * @returns {number|null} prochain pendingAnswerIndex
 */
export function nextPendingAnswerAfterCommit({
  commitOk,
  pendingAnswerIndex,
  confirmedIndex,
} = {}) {
  if (!commitOk) {
    return Number.isInteger(pendingAnswerIndex) ? pendingAnswerIndex : null;
  }
  if (
    Number.isInteger(pendingAnswerIndex) &&
    confirmedIndex === pendingAnswerIndex
  ) {
    return null;
  }
  // Succès RPC mais mapping distant pas encore visible : garder la sélection.
  if (Number.isInteger(pendingAnswerIndex)) return pendingAnswerIndex;
  return null;
}

/**
 * Hint sous les réponses — ne jamais traiter le pending seul comme « enregistré ».
 *
 * @param {{
 *   phase?: string|null,
 *   answerCommitInFlight?: boolean,
 *   confirmedIndex?: number|null,
 *   pendingAnswerIndex?: number|null,
 *   answerCommitFailed?: boolean,
 *   allAnswersIn?: boolean,
 * }} input
 * @returns {string}
 */
export function buildTriviaAnswerWaitingMessage({
  phase = null,
  answerCommitInFlight = false,
  confirmedIndex = null,
  pendingAnswerIndex = null,
  answerCommitFailed = false,
  allAnswersIn = false,
} = {}) {
  if (phase !== "question") return "";
  if (answerCommitInFlight) return "Envoi de ta réponse…";
  if (Number.isInteger(confirmedIndex)) {
    return allAnswersIn
      ? "Tout le monde a répondu. Révélation en cours…"
      : "Réponse enregistrée — tu peux encore la modifier · en attente des autres…";
  }
  if (answerCommitFailed && Number.isInteger(pendingAnswerIndex)) {
    return "Envoi échoué — retente ou change de réponse.";
  }
  if (Number.isInteger(pendingAnswerIndex)) {
    // Uniquement post-succès RPC : pending gardé tant que answers distant n'a pas mappé
    // le joueur (inFlight déjà false, failed false). Pas un cas « recliquer pour envoyer ».
    return "Réponse envoyée — vérification en cours…";
  }
  return "Choisis ta réponse (tu pourras la modifier avant la révélation).";
}
