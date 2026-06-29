/** Barème unifié de la soirée (classement lobby). Le Fil Rouge a son propre compteur. */

export const EVENING_POINTS = {
  /** Victoire standard de manche */
  WIN: 10,
  /** Récompense forte (dissent, menteur, bluff, consensus parfait tier…) */
  BONUS: 15,
};

/** Points Fil Rouge (Mot interdit - désactivé, voir data/filRouge.js FIL_ROUGE_ENABLED) */
export const FIL_ROUGE_POINTS = {
  MISSION: 50,
};

/** Tier Night : écart de rang vs consensus → points */
export function tierNightPointsForRankDiff(diff) {
  if (diff <= 0) return EVENING_POINTS.BONUS;
  if (diff === 1) return EVENING_POINTS.WIN;
  return 0;
}

/** Tier Night (modifier « À contre-courant ») : plus tu t'éloignes, plus tu marques. */
export function tierNightReversePointsForRankDiff(diff) {
  if (diff >= 3) return EVENING_POINTS.BONUS;
  if (diff === 2) return EVENING_POINTS.WIN;
  return 0;
}
