import { escapeHtml } from "../core/ui.js";
import { withCompetitionRanks } from "../core/competitionRank.js";

function formatScore(value) {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function renderConsensusScoreboard({
  standings = [],
  title = "Classement Consensus",
  deltaMap = {},
} = {}) {
  if (!standings.length) return "";

  const ranked = withCompetitionRanks(standings, (p) => p.score || 0);

  return `
    <div class="card game-scores-box consensus-scoreboard">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      ${ranked
        .map((player) => {
          const delta = deltaMap[player.name] || 0;
          return `
            <div class="game-scores-box__row consensus-scoreboard__row ${delta > 0 ? "consensus-scoreboard__row--bump" : ""}">
              <span class="game-scores-box__rank">${player.rank}</span>
              <div class="avatar avatar--sm" style="background:${player.color}">${player.emoji}</div>
              <span class="player-name game-scores-box__name">${escapeHtml(player.name)}</span>
              ${delta > 0 ? `<span class="consensus-scoreboard__delta">+${formatScore(delta)}</span>` : ""}
              <span class="player-score ${player.rank === 1 ? "player-score--gold" : ""}">${formatScore(player.score || 0)}</span>
            </div>`;
        })
        .join("")}
    </div>`;
}
