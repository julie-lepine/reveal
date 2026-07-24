/**
 * Plan + champs play Guess The Lie (I-08 / ARCH-03) — purs, testables hors gameSync.
 */
import { pickRemotePlayFields } from "./playPatch.js";
import { ACTING_HOST_PLAY_ALLOWED_KEYS } from "./gameSessionSecurity.js";

/**
 * @returns {{ channel: 'local'|'patchGameState'|'actingRpc'|'noop', withEveningScores: boolean }}
 */
export function planGuessLiePlayWrite({
  isSyncActive,
  isRealHost,
  canAct,
  withEveningScores = false,
} = {}) {
  if (!isSyncActive) {
    return { channel: "local", withEveningScores: false };
  }
  if (isRealHost) {
    return { channel: "patchGameState", withEveningScores: Boolean(withEveningScores) };
  }
  if (canAct) {
    return { channel: "actingRpc", withEveningScores: false };
  }
  return { channel: "noop", withEveningScores: false };
}

/**
 * @param {object} fullRemote — typiquement guessLieToRemote(session)
 * @param {object} patch — patch local (clés à propager)
 */
export function buildGuessLieActingPlayFields(fullRemote, patch) {
  const playPatch = pickRemotePlayFields(fullRemote, patch);
  const out = {};
  for (const [key, value] of Object.entries(playPatch)) {
    if (ACTING_HOST_PLAY_ALLOWED_KEYS.has(key)) out[key] = value;
  }
  return out;
}
