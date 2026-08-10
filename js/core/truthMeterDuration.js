/**
 * Estimation durée TruthMeter (prep).
 * 1 manche / joueur : écriture auteur + timers vote/reveal + marge débat.
 */

import {
  TRUTH_METER_VOTE_TIMER_SEC,
  TRUTH_METER_DISPLAY_SEC,
  TRUTH_METER_REVEAL_HOLD_SEC,
  TRUTH_METER_INTERMISSION_SEC,
} from "../../data/truthMeter.js";
import { formatDurationRange } from "./hotTakeDuration.js";

export { formatDurationRange };

const WRITE_MIN_SEC = 40;
const WRITE_MAX_SEC = 60;
const DEBATE_MIN_SEC = 10;
const DEBATE_MAX_SEC = 20;

const TIMED_SEC =
  TRUTH_METER_VOTE_TIMER_SEC +
  TRUTH_METER_DISPLAY_SEC +
  TRUTH_METER_REVEAL_HOLD_SEC +
  TRUTH_METER_INTERMISSION_SEC;

/**
 * @param {number} playerCount - = nombre de manches
 * @returns {{ minSec: number, maxSec: number, label: string }}
 */
export function estimateTruthMeterDuration(playerCount) {
  const n = Math.max(0, Number(playerCount) || 0);
  if (n === 0) {
    return { minSec: 0, maxSec: 0, label: "-" };
  }
  const minSec = Math.round(n * (WRITE_MIN_SEC + TIMED_SEC + DEBATE_MIN_SEC));
  const maxSec = Math.round(n * (WRITE_MAX_SEC + TIMED_SEC + DEBATE_MAX_SEC));
  return {
    minSec,
    maxSec,
    label: formatDurationRange(minSec, maxSec),
  };
}
