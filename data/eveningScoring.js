/** Barème unifié de la soirée (classement lobby). */

export const EVENING_POINTS = {
  /** Victoire standard de manche */
  WIN: 10,
  /** Récompense forte (dissent, menteur, bluff, consensus parfait tier…) */
  BONUS: 15,
};

/**
 * BUG-TIERNIGHT-SERIES-QA-02 — bonus outsider TierNight uniquement.
 * Ne pas réutiliser EVENING_POINTS.BONUS (+15) : partagé HotTake / Dilemma / etc.
 */
export const TIER_NIGHT_OUTSIDER_BONUS = 5;

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
