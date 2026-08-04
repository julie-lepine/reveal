/**
 * SYN-15 / SYN-16 - migrate evening name-keyed maps when roster proves a rename
 * (same userId, display name changed). Pur / testable (sans Supabase).
 */
import { mergePlayerStatsRecord } from "./playerStatsSync.js";

/**
 * @param {Array<{ userId?: string, name?: string }>} prev
 * @param {Array<{ userId?: string, name?: string }>} next
 * @returns {Array<{ userId: string, oldName: string, newName: string }>}
 */
export function detectParticipantRenames(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return [];
  if (!prev.length || !next.length) return [];

  const prevByUid = new Map();
  for (const p of prev) {
    const uid = p?.userId != null && p.userId !== "" ? String(p.userId) : "";
    const name = typeof p?.name === "string" ? p.name : "";
    if (!uid || !name) continue;
    prevByUid.set(uid, name);
  }
  if (!prevByUid.size) return [];

  const renames = [];
  for (const p of next) {
    const uid = p?.userId != null && p.userId !== "" ? String(p.userId) : "";
    const newName = typeof p?.name === "string" ? p.name : "";
    if (!uid || !newName) continue;
    const oldName = prevByUid.get(uid);
    if (oldName == null || oldName === newName) continue;
    renames.push({ userId: uid, oldName, newName });
  }
  return renames;
}

function effectiveRenamesForMap(map, renames) {
  if (!map || typeof map !== "object" || !renames?.length) return [];
  return renames.filter(
    (r) => r.oldName && r.newName && r.oldName !== r.newName && map[r.oldName] !== undefined
  );
}

/**
 * Snapshot two-phase migrate for flat numeric maps (scores).
 * Avoids in-place chain corruption on multi-rename / theoretical swaps.
 * @param {Record<string, number>} map
 * @param {Array<{ oldName: string, newName: string }>} renames
 * @returns {Record<string, number>}
 */
export function migrateNumericNameMapMax(map, renames) {
  const effective = effectiveRenamesForMap(map, renames);
  if (!effective.length) return map || {};

  const snapshot = { ...map };
  const next = { ...map };
  for (const { oldName } of effective) {
    delete next[oldName];
  }
  for (const { oldName, newName } of effective) {
    const oldVal = snapshot[oldName];
    if (oldVal === undefined) continue;
    if (next[newName] === undefined) {
      next[newName] = oldVal;
    } else {
      next[newName] = Math.max(Number(next[newName]) || 0, Number(oldVal) || 0);
    }
  }
  return next;
}

/**
 * Baseline / I-09 preferOld: valeur sous l'ancien nom gagne en collision.
 * @param {Record<string, number>} map
 * @param {Array<{ oldName: string, newName: string }>} renames
 */
export function migrateNumericNameMapPreferOld(map, renames) {
  const effective = effectiveRenamesForMap(map, renames);
  if (!effective.length) return map || {};

  const snapshot = { ...map };
  const next = { ...map };
  for (const { oldName } of effective) {
    delete next[oldName];
  }
  for (const { oldName, newName } of effective) {
    const oldVal = snapshot[oldName];
    if (oldVal === undefined) continue;
    next[newName] = oldVal;
  }
  return next;
}

/**
 * @param {Record<string, object>} playerStats
 * @param {Array<{ oldName: string, newName: string }>} renames
 */
export function migratePlayerStatsForRenames(playerStats, renames) {
  const effective = effectiveRenamesForMap(playerStats, renames);
  if (!effective.length) return playerStats || {};

  const snapshot = { ...playerStats };
  const next = { ...playerStats };
  for (const { oldName } of effective) {
    delete next[oldName];
  }
  for (const { oldName, newName } of effective) {
    const oldVal = snapshot[oldName];
    if (oldVal === undefined) continue;
    next[newName] = mergePlayerStatsRecord(next[newName], oldVal);
  }
  return next;
}

/**
 * gameScores nested - Math.max par joueur dans chaque gameId.
 * @param {Record<string, Record<string, number>>} gameScores
 * @param {Array<{ oldName: string, newName: string }>} renames
 */
export function migrateGameScoresForRenames(gameScores, renames) {
  if (!gameScores || typeof gameScores !== "object" || !renames?.length) {
    return gameScores || {};
  }
  let any = false;
  const next = { ...gameScores };
  for (const gameId of Object.keys(next)) {
    const inner = next[gameId];
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) continue;
    const migrated = migrateNumericNameMapMax(inner, renames);
    if (migrated !== inner) {
      next[gameId] = migrated;
      any = true;
    }
  }
  return any ? next : gameScores;
}

function mapsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * @param {{
 *   scores?: Record<string, number>,
 *   playerStats?: Record<string, object>,
 *   gameScores?: Record<string, Record<string, number>>,
 *   gameScoreSessionBaseline?: Record<string, number>,
 * }} maps
 * @param {Array<{ oldName: string, newName: string }>} renames
 */
export function migrateEveningMapsForRosterRenames(maps, renames) {
  const scoresIn = maps?.scores || {};
  const statsIn = maps?.playerStats || {};
  const gamesIn = maps?.gameScores || {};
  const baselineIn = maps?.gameScoreSessionBaseline || {};

  if (!renames?.length) {
    return {
      changed: false,
      scores: scoresIn,
      playerStats: statsIn,
      gameScores: gamesIn,
      gameScoreSessionBaseline: baselineIn,
    };
  }

  const scores = migrateNumericNameMapMax(scoresIn, renames);
  const playerStats = migratePlayerStatsForRenames(statsIn, renames);
  const gameScores = migrateGameScoresForRenames(gamesIn, renames);
  const gameScoreSessionBaseline = migrateNumericNameMapPreferOld(
    baselineIn,
    renames
  );

  const changed =
    !mapsEqual(scores, scoresIn) ||
    !mapsEqual(playerStats, statsIn) ||
    !mapsEqual(gameScores, gamesIn) ||
    !mapsEqual(gameScoreSessionBaseline, baselineIn);

  return {
    changed,
    scores,
    playerStats,
    gameScores,
    gameScoreSessionBaseline,
  };
}
