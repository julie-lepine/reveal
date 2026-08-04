/**
 * Hint prep : entrées custom d'autres joueurs (masquées jusqu'à la manche).
 * Module pur — partagé Hot Take / Dilemma (FEATURE-DILEMMA-01).
 */
export function prepOthersCustomEntriesHintHtml({
  count,
  hintId,
  itemLabel,
  revealedPast,
}) {
  if (!count) return "";
  const plural = count > 1;
  return `<p class="hint" id="${hintId}">${count} ${itemLabel}${plural ? "s" : ""} d'autres joueurs - ${revealedPast}${plural ? "s" : ""} en manche.</p>`;
}
