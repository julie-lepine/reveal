/**
 * UI « sélection locale → Valider mon vote » (Guess Lie, Hot Take, Dilemma, Traître…).
 * `selected` = choix en cours ; `committed` = vote déjà envoyé au serveur.
 */
export function voteConfirmChrome({
  selected,
  committed,
  allIn = false,
  emptyHint = "Choisis ton vote.",
  confirmLabelActive = "Valider mon vote",
}) {
  const displayPick = selected != null ? selected : committed;
  const hasPendingChange = selected != null && selected !== committed;
  const hint =
    committed == null && selected == null
      ? emptyHint
      : allIn
        ? "Tout le monde a voté !"
        : committed != null && !hasPendingChange
          ? "Vote enregistré - en attente des autres joueurs…"
          : "Tu peux modifier ton vote avant de valider.";
  const confirmDisabled =
    displayPick == null || (committed != null && !hasPendingChange && !allIn);
  const confirmLabel =
    allIn && committed != null && !hasPendingChange
      ? "Tout le monde a voté !"
      : committed != null && !hasPendingChange
        ? "En attente des autres joueurs…"
        : confirmLabelActive;
  const confirmClass = confirmDisabled ? "btn-secondary" : "btn-primary";
  return {
    displayPick,
    hasPendingChange,
    hint,
    confirmDisabled,
    confirmLabel,
    confirmClass,
  };
}

/** Vote à envoyer : le choix local en cours prime sur le vote déjà commité. */
export function pickForVoteConfirm(selected, committed) {
  return selected != null ? selected : committed ?? null;
}
