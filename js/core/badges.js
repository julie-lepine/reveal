import { getState } from "./state.js";
import { getSortedEveningStandingPlayers } from "./players.js";
import { buildBadgeMap } from "./badgeRules.js";

export const MVP_BADGE = "MVP de la soirée";
export const PROGRESS_BADGE = "En progression";

/**
 * Badges de repli (joueur sans badge de stat), audit badges et stats n°3 :
 * - « MVP de la soirée » pour chaque joueur à égalité en tête, avec au moins 1 point ;
 * - « En progression » pour un dernier seul, avec au moins 1 point, derrière tous
 *   les autres.
 * @param {Array<{ name: string, score: number }>} players classement de la soirée
 * @returns {Record<string, string>}
 */
export function buildFallbackBadgeMap(players = []) {
  const out = {};
  if (!players.length) return out;
  const scores = players.map((p) => Number(p.score) || 0);
  const top = Math.max(...scores);
  const bottom = Math.min(...scores);
  if (top > 0) {
    players.forEach((p, i) => {
      if (scores[i] === top) out[p.name] = MVP_BADGE;
    });
  }
  const lasts = players.filter((_, i) => scores[i] === bottom);
  if (players.length > 1 && lasts.length === 1 && bottom > 0 && bottom < top) {
    out[lasts[0].name] = PROGRESS_BADGE;
  }
  return out;
}

export { buildBadgeMap } from "./badgeRules.js";

/**
 * Badges sur le même classement que le podium : joueurs présents et joueurs
 * partis qui ont marqué des points (avant, seuls les présents comptaient : le 2e
 * pouvait être « MVP » derrière un joueur parti).
 */
export function getPlayerBadges() {
  const { playerStats, scores } = getState();
  const standings = getSortedEveningStandingPlayers().map((p) => ({
    ...p,
    score: scores[p.name] || 0,
  }));
  const statBadges = buildBadgeMap(
    playerStats,
    standings.map((p) => p.name)
  );
  const fallback = buildFallbackBadgeMap(standings);

  return standings.map((p) => ({
    ...p,
    badge: statBadges[p.name] || fallback[p.name] || "",
  }));
}

/** Badge d'un joueur (même logique que le classement). */
export function getBadgeForPlayer(playerName) {
  const entry = getPlayerBadges().find((p) => p.name === playerName);
  return entry?.badge || "";
}

/** Ligne « Nom · badge » pour les écrans récap. */
export function formatPlayerWithBadge(playerName) {
  const badge = getBadgeForPlayer(playerName);
  if (!badge) return playerName;
  return `${playerName} · ${badge}`;
}
