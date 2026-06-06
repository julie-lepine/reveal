/**
 * Réglages sync multijoueur / egress Supabase.
 * Sur localhost, le polling HTTP est espacé (Realtime reste le canal principal).
 */

/** true = intervalles de polling game_sessions × LOCALHOST_POLL_MULTIPLIER sur localhost. */
export const EGRESS_RELAX_POLL_ON_LOCALHOST = true;

/** Multiplicateur des intervalles de polling en dev local (ex. 3 → 2 s devient ~6 s). */
export const LOCALHOST_POLL_MULTIPLIER = 3;

/** Timeout par défaut des patches / push Supabase (lancement, sync MP). */
export const SYNC_PATCH_TIMEOUT_MS = 20000;

export function isLocalDevEnvironment() {
  if (typeof location === "undefined") return false;
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function shouldRelaxGameSessionPolling() {
  return EGRESS_RELAX_POLL_ON_LOCALHOST && isLocalDevEnvironment();
}

export function gameSessionPollMultiplier() {
  return shouldRelaxGameSessionPolling() ? LOCALHOST_POLL_MULTIPLIER : 1;
}

export function scalePollIntervalMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return ms;
  return Math.round(n * gameSessionPollMultiplier());
}
