import { SPEED_VOTE_TIMER_SEC, SPEED_VOTE_ROUND_ALL } from "../../data/speedVote.js";

const RESULTS_PAUSE_SEC = 12;

export { SPEED_VOTE_ROUND_ALL };

export function speedVoteTimerSeconds(roundCount) {
  const n = Math.max(0, roundCount);
  if (n === 0) return 0;
  return n * SPEED_VOTE_TIMER_SEC;
}

export function estimateSpeedVoteDuration(roundCount) {
  const n = Math.max(0, roundCount);
  if (n === 0) {
    return { minSec: 0, maxSec: 0, label: "-" };
  }
  const timers = speedVoteTimerSeconds(n);
  const minSec = timers + n * RESULTS_PAUSE_SEC;
  const maxSec = minSec + n * 8;
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
  return `~${minMin}-${maxMin} min`;
}

export function resolveEffectiveRoundCount(requested, poolSize) {
  if (poolSize <= 0) return 0;
  if (requested === SPEED_VOTE_ROUND_ALL || requested == null || requested >= poolSize) {
    return poolSize;
  }
  return Math.min(requested, poolSize);
}
