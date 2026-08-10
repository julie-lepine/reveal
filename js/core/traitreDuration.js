/**
 * Estimation durée Spot the fake (prep).
 * Pas de sélecteur de manches : fourchettes produit selon taille du lobby.
 */

import { formatDurationRange } from "./hotTakeDuration.js";

export { formatDurationRange };

/**
 * @param {number} playerCount
 * @returns {{ minSec: number, maxSec: number, label: string }}
 */
export function estimateTraitreDuration(playerCount) {
  const n = Math.max(0, Number(playerCount) || 0);
  if (n < 3) {
    return { minSec: 0, maxSec: 0, label: "-" };
  }
  let minSec;
  let maxSec;
  if (n <= 4) {
    minSec = 8 * 60;
    maxSec = 12 * 60;
  } else if (n <= 6) {
    minSec = 12 * 60;
    maxSec = 18 * 60;
  } else {
    minSec = 15 * 60;
    maxSec = 25 * 60;
  }
  return {
    minSec,
    maxSec,
    label: formatDurationRange(minSec, maxSec),
  };
}
