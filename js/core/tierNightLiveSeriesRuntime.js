/**
 * FEATURE-TIERNIGHT-04F — runtime série Rank Live (phases, projection manche, helpers).
 *
 * Projection : items depuis `queue[i].listSnapshot` uniquement (jamais catalogue).
 * Pas d’import vers tierNightLiveSeriesLaunch (évite cycle ES).
 */
import { shuffleArray } from "./combinedGameDeck.js";

export const TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING = "playing_list";
export const TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN = "between_lists";
export const TIER_NIGHT_LIVE_SERIES_PHASE_END = "series_end";

/**
 * @param {unknown} series
 * @returns {{ ok: true, round: object } | { ok: false, code: string, round: null }}
 */
export function getActiveTierNightLiveSeriesRound(series) {
  if (!series || typeof series !== "object") {
    return { ok: false, code: "NO_SERIES", round: null };
  }
  const queue = Array.isArray(series.queue) ? series.queue : null;
  if (!queue) return { ok: false, code: "INVALID_QUEUE", round: null };
  const idx = Number(series.roundIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= queue.length) {
    return { ok: false, code: "ROUND_INDEX_OUT_OF_BOUNDS", round: null };
  }
  const round = queue[idx];
  if (!round || typeof round !== "object") {
    return { ok: false, code: "MISSING_ROUND", round: null };
  }
  return {
    ok: true,
    round: {
      roundIndex: round.roundIndex,
      roundId: round.roundId,
      listId: round.listId,
      listSnapshot: round.listSnapshot
        ? {
            ...round.listSnapshot,
            items: Array.isArray(round.listSnapshot.items)
              ? round.listSnapshot.items.map(String)
              : [],
          }
        : null,
    },
  };
}

/**
 * Dernière liste = plus de suivante. Vérité : `queue.length` (pas un roundCount stale).
 * @param {unknown} series
 */
export function isTierNightLiveSeriesLastRound(series) {
  if (!series || typeof series !== "object") return false;
  const queueLen = Array.isArray(series.queue) ? series.queue.length : 0;
  const roundCount = Number(series.roundCount);
  const total =
    queueLen > 0
      ? queueLen
      : Number.isInteger(roundCount) && roundCount >= 1
        ? roundCount
        : 0;
  if (total < 1) return false;
  const roundIndex = Number(series.roundIndex);
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return false;
  return roundIndex >= total - 1;
}

/**
 * Projection gameplay d’une manche depuis le snapshot queue (pas le catalogue).
 * @param {object} series
 * @param {number} roundIndex
 * @param {unknown[]} [playerRoster]
 * @param {() => number} [random]
 */
export function projectTierNightLiveSeriesRound(
  series,
  roundIndex,
  playerRoster = [],
  random = Math.random
) {
  if (!series || typeof series !== "object" || !Array.isArray(series.queue)) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "series" };
  }
  const idx = Number(roundIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= series.queue.length) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "roundIndex" };
  }
  const entry = series.queue[idx];
  const snap = entry?.listSnapshot;
  if (!snap || typeof snap !== "object") {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "snapshot" };
  }
  if (!Array.isArray(snap.items) || snap.items.length < 1) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "snapshot_items" };
  }
  const deck = shuffleArray(snap.items.map(String), random);
  return {
    ok: true,
    live: {
      runId: series.runId,
      lobbyStarted: true,
      finished: false,
      series,
      topicId: String(snap.id || ""),
      listName: snap.name != null ? String(snap.name) : "",
      deck,
      playerRoster: Array.isArray(playerRoster) ? playerRoster : [],
      placements: {},
      roundIdx: 0,
      phase: "voting",
      votes: {},
    },
  };
}

/**
 * Wrapper launch 04E — projection round 0.
 */
export function projectTierNightLiveSeriesRound0(
  series,
  playerRoster = [],
  random = Math.random
) {
  return projectTierNightLiveSeriesRound(series, 0, playerRoster, random);
}

/**
 * Progress helper (between UI).
 * @param {unknown} series
 */
export function getTierNightLiveSeriesProgress(series) {
  if (!series || typeof series !== "object") {
    return { ok: false, code: "NO_SERIES" };
  }
  const roundCount = Number(series.roundCount);
  const roundIndex = Number(series.roundIndex);
  const active = getActiveTierNightLiveSeriesRound(series);
  return {
    ok: true,
    roundIndex: Number.isInteger(roundIndex) ? roundIndex : null,
    roundCount: Number.isInteger(roundCount) ? roundCount : null,
    phase: typeof series.phase === "string" ? series.phase : null,
    isLastRound: isTierNightLiveSeriesLastRound(series),
    activeRound: active.ok ? active.round : null,
    scoredRoundIds: Array.isArray(series.scoredRoundIds)
      ? series.scoredRoundIds.map(String)
      : [],
    completedRoundIds: Array.isArray(series.completedRoundIds)
      ? series.completedRoundIds.map(String)
      : [],
  };
}
