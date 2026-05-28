import { DILEMMA_VOTE_TIMER_SEC, DILEMMA_REVEAL_HOLD_SEC, DILEMMA_ROUND_ALL } from "../../data/dilemma.js";

export { DILEMMA_ROUND_ALL };

export function estimateDilemmaDuration(roundCount) {
  const n = Math.max(0, roundCount);
  if (n === 0) {
    return { minSec: 0, maxSec: 0, label: "-" };
  }
  const perRound = DILEMMA_VOTE_TIMER_SEC + DILEMMA_REVEAL_HOLD_SEC + 2;
  const minSec = n * perRound;
  const maxSec = minSec + n * 5;
  const minMin = Math.max(1, Math.round(minSec / 60));
  const maxMin = Math.max(minMin, Math.round(maxSec / 60));
  const label = minMin === maxMin ? `~${minMin} min` : `~${minMin}-${maxMin} min`;
  return { minSec, maxSec, label };
}

export function resolveEffectiveRoundCount(requested, poolSize) {
  if (poolSize <= 0) return 0;
  if (requested === DILEMMA_ROUND_ALL || requested == null || requested >= poolSize) {
    return poolSize;
  }
  return Math.min(requested, poolSize);
}
