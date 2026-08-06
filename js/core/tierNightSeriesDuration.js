/**
 * FEATURE-TIERNIGHT-03-B — estimation durée série « Classe le groupe ».
 * Basé sur ~2 min / manche (produit) — pas les timers Hot Take.
 */

import { formatDurationRange } from "./hotTakeDuration.js";

export { formatDurationRange };

/** Fourchettes produit (min/max secondes) pour 3 / 5 / 8. */
const TIER_NIGHT_SERIES_DURATION_BY_COUNT = Object.freeze({
  3: { minSec: 5 * 60, maxSec: 7 * 60 },
  5: { minSec: 8 * 60, maxSec: 12 * 60 },
  8: { minSec: 13 * 60, maxSec: 18 * 60 },
});

/**
 * @param {number} roundCount
 * @returns {{ minSec: number, maxSec: number, label: string }}
 */
export function estimateTierNightSeriesDuration(roundCount) {
  const n = Number(roundCount);
  const range = TIER_NIGHT_SERIES_DURATION_BY_COUNT[n];
  if (!range) {
    if (!Number.isFinite(n) || n <= 0) {
      return { minSec: 0, maxSec: 0, label: "-" };
    }
    const minSec = Math.round(n * 100);
    const maxSec = Math.round(n * 135);
    return { minSec, maxSec, label: formatDurationRange(minSec, maxSec) };
  }
  return {
    minSec: range.minSec,
    maxSec: range.maxSec,
    label: formatDurationRange(range.minSec, range.maxSec),
  };
}
