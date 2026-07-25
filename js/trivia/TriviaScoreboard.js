import { escapeHtml } from "../core/ui.js";
import { withCompetitionRanks } from "../core/competitionRank.js";

export function renderTriviaScoreboard({
  standings = [],
  title = "Classement du quiz",
  deltaMap = {},
} = {}) {
  if (!standings.length) return "";

  const ranked = withCompetitionRanks(standings, (p) => p.score || 0);

  return `
    <div class="card game-scores-box trivia-scoreboard">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      ${ranked
        .map((player) => {
          const delta = deltaMap[player.name] || 0;
          return `
            <div class="game-scores-box__row trivia-scoreboard__row ${delta > 0 ? "trivia-scoreboard__row--bump" : ""}">
              <span class="game-scores-box__rank">${player.rank}</span>
              <div class="avatar avatar--sm" style="background:${player.color}">${player.emoji}</div>
              <span class="player-name game-scores-box__name">${escapeHtml(player.name)}</span>
              ${delta > 0 ? `<span class="trivia-scoreboard__delta">+${delta}</span>` : ""}
              <span class="player-score ${player.rank === 1 ? "player-score--gold" : ""}">${player.score || 0}</span>
            </div>`;
        })
        .join("")}
    </div>`;
}
