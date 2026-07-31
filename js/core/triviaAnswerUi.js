/**
 * BUG-TRIVIA-01B-bis — sélection UI locale vs answers distantes (UID ou pseudo).
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
