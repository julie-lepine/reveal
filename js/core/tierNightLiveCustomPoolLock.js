/**
 * FEATURE-TIERNIGHT-04C - predicate pool customs Rank Live writable.
 *
 * Writable pendant prep.
 * Verrouillé dès launch canonique (série live) ou Rank Live mono actif.
 * Ready N'EST PAS un critère.
 */

/**
 * @param {Record<string, unknown>|null|undefined} sessionState
 *   Blob `game_sessions.state` OU projection locale équivalente
 *   (`customLiveTierListsWritable` + `tierNightLive`).
 * @returns {boolean}
 */
export function isTierNightLiveCustomPoolWritable(sessionState = {}) {
  if (!sessionState || typeof sessionState !== "object") return true;

  if (sessionState.customLiveTierListsWritable === false) return false;

  const live = sessionState.tierNightLive;
  if (!live || typeof live !== "object") return true;

  const series = live.series;
  if (series && typeof series === "object" && String(series.kind || "") === "live") {
    return false;
  }

  const started = live.lobbyStarted === true;
  const finished = live.finished === true;
  if (started && !finished) return false;

  return true;
}

/**
 * Variante locale : lit writable + tierNightLiveGame (state app).
 * @param {{
 *   customLiveTierListsWritable?: boolean,
 *   tierNightLiveGame?: object|null
 * }} [localState]
 */
export function isLocalTierNightLiveCustomPoolWritable(localState = {}) {
  return isTierNightLiveCustomPoolWritable({
    customLiveTierListsWritable: localState.customLiveTierListsWritable,
    tierNightLive: localState.tierNightLiveGame || null,
  });
}
