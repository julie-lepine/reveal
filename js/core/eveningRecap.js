import { getState, getLieSuccessRate } from "./state.js";
import { getLobbyParticipants } from "./lobby.js";
import { getSortedActivePlayers } from "./players.js";

export function getEveningRecap() {
  const { stats, scores, tierNightGame } = getState();
  const participants = getLobbyParticipants();
  const sorted = getSortedActivePlayers();
  const top = sorted
    .filter((p) => (scores[p.name] || 0) > 0)
    .slice(0, 3)
    .map((p) => ({ ...p, score: scores[p.name] || 0 }));

  const hotTakes = stats.hotTakesPlayed || 0;
  const liesTotal = stats.liesTotal || 0;
  const liesFound = stats.liesFound || 0;
  const tierNights = stats.tierNightsPlayed || 0;
  const lastTier = tierNightGame?.listName || null;

  const hasActivity =
    hotTakes > 0 || liesTotal > 0 || tierNights > 0 || top.length > 0;

  return {
    participantCount: participants.length,
    hotTakes,
    liesFound,
    liesTotal,
    lieRate: getLieSuccessRate(),
    tierNights,
    lastTier,
    top,
    hasActivity,
  };
}
