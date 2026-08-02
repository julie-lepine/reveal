/**
 * BUG-WAO-02 / BUG-WAO-03 — décisions de rendu Wrong Answer Only (pures, testables).
 * Full render uniquement sur changements structurels ; sinon refresh chrome ciblé.
 */

/**
 * @param {{
 *   prevPhase: string|null,
 *   phase: string|null,
 *   prevRound: number|null,
 *   roundIdx: number|null,
 *   actingHostUiRefresh?: boolean,
 *   composeLayoutMismatch?: boolean,
 *   voteListAuthorsChanged?: boolean,
 * }} opts
 */
export function shouldFullRenderWrongAnswer(opts = {}) {
  const {
    prevPhase,
    phase,
    prevRound,
    roundIdx,
    actingHostUiRefresh = false,
    composeLayoutMismatch = false,
    voteListAuthorsChanged = false,
  } = opts;
  if (actingHostUiRefresh) return true;
  if (phase !== prevPhase) return true;
  if (roundIdx !== prevRound) return true;
  // Formulaire ↔ feedback (soumission locale) : structure différente.
  if (phase === "answer" && composeLayoutMismatch) return true;
  // Auteurs de la liste de vote changés (normalement figés à l'entrée en vote).
  if (phase === "voting" && voteListAuthorsChanged) return true;
  return false;
}

export function wrongAnswerComposeStatusText({
  submitted,
  mp,
  allIn,
  answeredCount,
  total,
}) {
  if (!submitted) return "Donne la pire réponse possible, en secret 🤫";
  if (!mp) return "Réponse envoyée !";
  if (allIn) return "Tout le monde a répondu !";
  return `Réponse envoyée - en attente des autres (${answeredCount}/${total})…`;
}

export function wrongAnswerVoteStatusText({
  voted,
  allIn,
  votedCount,
  total,
}) {
  if (!voted) {
    return "Vote pour la PIRE réponse (tu ne peux pas voter pour la tienne).";
  }
  if (allIn) return "Tout le monde a voté !";
  return `Vote enregistré - en attente des autres (${votedCount}/${total})…`;
}

export function wrongAnswerConfirmVoteState({
  displayPick,
  localName,
  voted,
}) {
  const confirmDisabled =
    displayPick == null || displayPick === localName || voted;
  return {
    confirmDisabled,
    label: voted ? "Vote enregistré" : "Valider mon vote",
  };
}

/** Auteurs ayant une réponse texte (clés stables pour la liste de vote). */
export function wrongAnswerAuthorNames(answers = {}) {
  return Object.keys(answers || {})
    .filter((n) => answers[n]?.text)
    .sort();
}
