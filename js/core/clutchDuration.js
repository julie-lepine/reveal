/**
 * Estimation durée Clutch (prep).
 * Basé sur les timers produit (précompte + cible + grâce) + pause reveal estimée.
 */

import {
  CLUTCH_PRECOUNT_MS,
  CLUTCH_MIN_TARGET_MS,
  CLUTCH_MAX_TARGET_MS,
  CLUTCH_GRACE_MS,
} from "../../data/clutch.js";
import { formatDurationRange } from "./hotTakeDuration.js";

export { formatDurationRange };

/** Lecture podium / débat avant manche suivante. */
const REVEAL_MIN_SEC = 15;
const REVEAL_MAX_SEC = 30;

/**
 * @param {number} roundCount
 * @returns {{ minSec: number, maxSec: number, label: string }}
 */
export function estimateClutchDuration(roundCount) {
  const n = Math.max(0, Number(roundCount) || 0);
  if (n === 0) {
    return { minSec: 0, maxSec: 0, label: "-" };
  }
  const playMinSec =
    (CLUTCH_PRECOUNT_MS + CLUTCH_MIN_TARGET_MS + CLUTCH_GRACE_MS) / 1000;
  const playMaxSec =
    (CLUTCH_PRECOUNT_MS + CLUTCH_MAX_TARGET_MS + CLUTCH_GRACE_MS) / 1000;
  const minSec = Math.round(n * (playMinSec + REVEAL_MIN_SEC));
  const maxSec = Math.round(n * (playMaxSec + REVEAL_MAX_SEC));
  return {
    minSec,
    maxSec,
    label: formatDurationRange(minSec, maxSec),
  };
}
