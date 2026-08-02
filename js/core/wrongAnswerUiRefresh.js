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

/**
 * Décision UI après sync distante.
 * Contrat BUG-WAO-02 : pendant composition active (même phase/manche), jamais de full render
 * — même si actingHostUiRefresh ou un faux positif composeLayoutMismatch.
 *
 * @returns {{ mode: "full"|"refresh-answer"|"refresh-vote"|"refresh-reveal-scores", reason: string }}
 */
export function decideWrongAnswerRemoteUi(opts = {}) {
  const {
    prevPhase,
    phase,
    prevRound,
    roundIdx,
    composeFormAlive = false,
    localSubmitted = false,
    actingHostUiRefresh = false,
    composeLayoutMismatch = false,
    voteListAuthorsChanged = false,
  } = opts;

  const samePhase = phase === prevPhase;
  const sameRound = roundIdx === prevRound;

  // Hard gate : answers-only (ou nudge acting-host) pendant rédaction.
  if (
    phase === "answer" &&
    samePhase &&
    sameRound &&
    composeFormAlive &&
    !localSubmitted
  ) {
    return { mode: "refresh-answer", reason: "compose-alive-answers-only" };
  }

  if (
    shouldFullRenderWrongAnswer({
      prevPhase,
      phase,
      prevRound,
      roundIdx,
      actingHostUiRefresh,
      composeLayoutMismatch,
      voteListAuthorsChanged,
    })
  ) {
    return { mode: "full", reason: "structural" };
  }

  if (phase === "answer") return { mode: "refresh-answer", reason: "answer-chrome" };
  if (phase === "voting") return { mode: "refresh-vote", reason: "vote-chrome" };
  if (phase === "reveal" && prevPhase === "reveal") {
    return { mode: "refresh-reveal-scores", reason: "reveal-scores" };
  }
  return { mode: "full", reason: "fallback" };
}

/**
 * Après `root.innerHTML = …`, réattache le même nœud DOM pour `selector`
 * (ex. #wrong-input) afin de conserver focus + clavier mobile.
 *
 * @param {ParentNode & { innerHTML: string, querySelector: Function }} root
 * @param {string} html
 * @param {string} selector
 * @returns {{ before: Element|null, after: Element|null, sameNode: boolean, path: "reused"|"replaced"|"missing" }}
 */
export function rebuildRootPreservingNode(root, html, selector) {
  const before = root.querySelector(selector);
  root.innerHTML = html;
  let after = root.querySelector(selector);
  if (before && after && before !== after) {
    after.replaceWith(before);
    after = before;
    return { before, after, sameNode: true, path: "reused" };
  }
  if (before && after && before === after) {
    return { before, after, sameNode: true, path: "reused" };
  }
  if (!before && after) {
    return { before: null, after, sameNode: false, path: "replaced" };
  }
  return {
    before: before || null,
    after: after || null,
    sameNode: Boolean(before && after && before === after),
    path: after ? "replaced" : "missing",
  };
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
