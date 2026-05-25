import { escapeHtml } from "../core/ui.js";

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

  return `
    <div class="card game-scores-box consensus-scoreboard">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      ${standings
        .map((player, index) => {
          const delta = deltaMap[player.name] || 0;
          return `
            <div class="game-scores-box__row consensus-scoreboard__row ${delta > 0 ? "consensus-scoreboard__row--bump" : ""}">
              <span class="game-scores-box__rank">${index + 1}</span>
              <div class="avatar avatar--sm" style="background:${player.color}">${player.emoji}</div>
              <span class="player-name game-scores-box__name">${escapeHtml(player.name)}</span>
              ${delta > 0 ? `<span class="consensus-scoreboard__delta">+${formatScore(delta)}</span>` : ""}
              <span class="player-score ${index === 0 ? "player-score--gold" : ""}">${formatScore(player.score || 0)}</span>
            </div>`;
        })
        .join("")}
    </div>`;
}
