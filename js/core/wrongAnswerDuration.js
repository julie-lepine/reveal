/**
 * Estimation durée Wrong Answer Only (prep).
 * Heuristique produit : rédaction + vote + reveal (~90–150 s / manche).
 */

import { formatDurationRange } from "./hotTakeDuration.js";

export { formatDurationRange };

const SEC_PER_ROUND_MIN = 90;
const SEC_PER_ROUND_MAX = 150;

/**
 * @param {number} roundCount
 * @returns {{ minSec: number, maxSec: number, label: string }}
 */
export function estimateWrongAnswerDuration(roundCount) {
  const n = Math.max(0, Number(roundCount) || 0);
  if (n === 0) {
    return { minSec: 0, maxSec: 0, label: "-" };
  }
  const minSec = n * SEC_PER_ROUND_MIN;
  const maxSec = n * SEC_PER_ROUND_MAX;
  return {
    minSec,
    maxSec,
    label: formatDurationRange(minSec, maxSec),
  };
}
