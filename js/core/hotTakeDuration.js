import { HOT_TAKE_TIMER_SEC } from "../../data/hotTakes.js";

/** Aligné sur js/games/hotTake.js */
const INTERMISSION_SEC = 5;
const FIRST_LAUNCH_SEC = 15;
const REVEAL_MIN_SEC = 18;
const REVEAL_MAX_SEC = 42;

export const HOT_TAKE_ROUND_ALL = -1;

/** Secondes de timers automatiques (vote + intermissions) */
export function hotTakeTimerSeconds(roundCount) {
  const n = Math.max(0, roundCount);
  if (n === 0) return 0;
  return HOT_TAKE_TIMER_SEC + (n - 1) * (INTERMISSION_SEC + HOT_TAKE_TIMER_SEC);
}

/** Fourchette totale (timers + lecture / débat estimé) */
export function estimateHotTakeDuration(roundCount) {
  const n = Math.max(0, roundCount);
  if (n === 0) {
    return { minSec: 0, maxSec: 0, label: "—" };
  }
  const timers = hotTakeTimerSeconds(n);
  const minSec = timers + FIRST_LAUNCH_SEC + (n - 1) * REVEAL_MIN_SEC;
  const maxSec = timers + FIRST_LAUNCH_SEC + 10 + (n - 1) * REVEAL_MAX_SEC;
  return {
    minSec,
    maxSec,
    label: formatDurationRange(minSec, maxSec),
  };
}

export function formatDurationRange(minSec, maxSec) {
  const minMin = Math.max(1, Math.round(minSec / 60));
  const maxMin = Math.max(minMin, Math.round(maxSec / 60));
  if (minMin === maxMin) return `~${minMin} min`;
  return `~${minMin}–${maxMin} min`;
}

export function resolveEffectiveRoundCount(requested, poolSize) {
  if (poolSize <= 0) return 0;
  if (requested === HOT_TAKE_ROUND_ALL || requested == null || requested >= poolSize) {
    return poolSize;
  }
  return Math.min(requested, poolSize);
}
