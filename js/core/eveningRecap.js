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
  const speedVotes = stats.speedVotesPlayed || 0;
  const playlistGuesses = stats.playlistGuessesPlayed || 0;
  const triviaGames = stats.triviaGamesPlayed || 0;
  const truthMeters = stats.truthMetersPlayed || 0;
  const consensusGames = stats.consensusGamesPlayed || 0;
  const dilemmas = stats.dilemmasPlayed || 0;
  const liesTotal = stats.liesTotal || 0;
  const liesFound = stats.liesFound || 0;
  const tierNights = stats.tierNightsPlayed || 0;
  const lastTier = tierNightGame?.listName || null;

  const hasActivity =
    hotTakes > 0 ||
    speedVotes > 0 ||
    triviaGames > 0 ||
    truthMeters > 0 ||
    consensusGames > 0 ||
    dilemmas > 0 ||
    liesTotal > 0 ||
    tierNights > 0 ||
    top.length > 0;

  return {
    participantCount: participants.length,
    hotTakes,
    speedVotes,
    playlistGuesses,
    triviaGames,
    truthMeters,
    consensusGames,
    dilemmas,
    liesFound,
    liesTotal,
    lieRate: getLieSuccessRate(),
    tierNights,
    lastTier,
    top,
    hasActivity,
  };
}
