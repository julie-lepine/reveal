/**
 * UX-HIST-01 - joueurs pour classements / récaps de soirée (actifs + contributeurs partis).
 * Helpers purs (sans state) - sélecteurs live dans players.js.
 */

/** Fallback affichage si le joueur n’est plus dans le roster. */
export const EVENING_STANDING_FALLBACK = Object.freeze({
  emoji: "👤",
  color: "#64748B",
});

/**
 * Contribution soirée démontrable avec les maps actuelles.
 *
 * - `scores[name] !== 0` (fini) : points soirée non nuls (positifs ou négatifs si un jour utilisés).
 * - clé numérique dans un `gameScores[gameId][name]` : `creditGameScore` / `addScore` a tourné
 *   pour ce jeu (y compris valeur 0 si points 0 ont été crédités).
 *
 * Limite documentée : un joueur qui a « joué » sans jamais passer par `addScore` /
 * `creditGameScore` (seulement `ensurePlayerScore` → `scores[name] === 0`) est
 * indiscernable d’un passage lobby sans partie → exclu des historiques partis.
 *
 * @param {string} name
 * @param {{ scores?: Record<string, number>, gameScores?: Record<string, Record<string, number>>, gameId?: string|null }} maps
 */
export function nameHasEveningContribution(
  name,
  { scores = {}, gameScores = {}, gameId = null } = {}
) {
  if (!name) return false;

  if (gameId) {
    const v = gameScores?.[gameId]?.[name];
    return typeof v === "number" && Number.isFinite(v);
  }

  const s = scores?.[name];
  if (typeof s === "number" && Number.isFinite(s) && s !== 0) return true;

  for (const byName of Object.values(gameScores || {})) {
    if (!byName || typeof byName !== "object") continue;
    const v = byName[name];
    if (typeof v === "number" && Number.isFinite(v)) return true;
  }
  return false;
}

/**
 * @param {{ scores?: object, gameScores?: object, gameId?: string|null }} maps
 * @returns {Set<string>}
 */
export function collectEveningContributorNames({
  scores = {},
  gameScores = {},
  gameId = null,
} = {}) {
  const names = new Set();

  if (gameId) {
    const byName = gameScores?.[gameId] || {};
    for (const [name, v] of Object.entries(byName)) {
      if (typeof v === "number" && Number.isFinite(v)) names.add(name);
    }
    return names;
  }

  for (const [name, s] of Object.entries(scores || {})) {
    if (typeof s === "number" && Number.isFinite(s) && s !== 0) names.add(name);
  }
  for (const byName of Object.values(gameScores || {})) {
    if (!byName || typeof byName !== "object") continue;
    for (const [name, v] of Object.entries(byName)) {
      if (typeof v === "number" && Number.isFinite(v)) names.add(name);
    }
  }
  return names;
}

/**
 * Pur : union actifs + contributeurs historiques.
 * @param {{
 *   activePlayers?: Array<{ name: string, color?: string, emoji?: string, isLocal?: boolean, isHost?: boolean }>,
 *   scores?: Record<string, number>,
 *   gameScores?: Record<string, Record<string, number>>,
 *   gameId?: string|null,
 * }} opts
 */
export function buildEveningStandingPlayers({
  activePlayers = [],
  scores = {},
  gameScores = {},
  gameId = null,
} = {}) {
  const byName = new Map();

  for (const p of activePlayers) {
    if (!p?.name) continue;
    byName.set(p.name, {
      name: p.name,
      color: p.color || EVENING_STANDING_FALLBACK.color,
      emoji: p.emoji || EVENING_STANDING_FALLBACK.emoji,
      isLocal: Boolean(p.isLocal),
      isHost: Boolean(p.isHost),
      historical: false,
    });
  }

  const contributors = collectEveningContributorNames({ scores, gameScores, gameId });
  for (const name of contributors) {
    if (byName.has(name)) continue;
    byName.set(name, {
      name,
      color: EVENING_STANDING_FALLBACK.color,
      emoji: EVENING_STANDING_FALLBACK.emoji,
      isLocal: false,
      isHost: false,
      historical: true,
    });
  }

  return [...byName.values()];
}
