/**
 * Estimation durée Draw it ! (prépa uniquement).
 * Gameplay = roundCount × 60 s. Pas de timer live.
 */
import { DRAW_IT_ROUND_DURATION_MS } from "../../data/drawIt.js";
import { formatDurationRange } from "./hotTakeDuration.js";

export { formatDurationRange };

const ROUND_SEC = DRAW_IT_ROUND_DURATION_MS / 1000;

/**
 * @param {number} roundCount
 * @returns {{ minSec: number, maxSec: number, label: string }}
 */
export function estimateDrawItDuration(roundCount) {
  const n = Math.max(0, Number(roundCount) || 0);
  if (n === 0) {
    return { minSec: 0, maxSec: 0, label: "-" };
  }
  const minSec = n * ROUND_SEC;
  return {
    minSec,
    maxSec: minSec,
    label: formatDurationRange(minSec, minSec),
  };
}
