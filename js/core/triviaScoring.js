/**
 * Points soirée Trivia : cumul quiz (`score`) + bonus podium (`lobbyBonus`).
 * @param {{ score?: number, lobbyBonus?: number }} player
 */
export function triviaEveningPoints(player = {}) {
  const quizPts =
    typeof player.score === "number" && Number.isFinite(player.score) ? player.score : 0;
  const bonus =
    typeof player.lobbyBonus === "number" && Number.isFinite(player.lobbyBonus)
      ? player.lobbyBonus
      : 0;
  return quizPts + bonus;
}
