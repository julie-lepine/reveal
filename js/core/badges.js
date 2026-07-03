import { getState } from "./state.js";
import { getSortedActivePlayers } from "./players.js";
import { buildBadgeMap } from "./badgeRules.js";

function resolveFallbackBadge(index, total, hasStatBadge) {
  if (hasStatBadge) return "";
  if (index === 0) return "MVP de la soirée";
  if (total > 1 && index === total - 1) return "En progression";
  return "";
}

export { buildBadgeMap } from "./badgeRules.js";

export function getPlayerBadges() {
  const { playerStats, scores } = getState();
  const sorted = getSortedActivePlayers();
  const names = sorted.map((p) => p.name);
  const badgeByName = buildBadgeMap(playerStats, names);

  return sorted.map((p, index) => {
    const statBadge = badgeByName[p.name] || "";
    const badge = statBadge || resolveFallbackBadge(index, sorted.length, Boolean(statBadge));
    return { ...p, badge, score: scores[p.name] || 0 };
  });
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
