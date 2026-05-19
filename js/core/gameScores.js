import { getSortedActivePlayers } from "./players.js";
import { getState } from "./state.js";
import { escapeHtml } from "./ui.js";

/** Boîte de cumul des scores (soirée) affichée en fin de manche. */
export function gameCumulativeScoresHtml({ gameLabel = null, title = "Cumul des scores" } = {}) {
  const { scores } = getState();
  const players = getSortedActivePlayers();
  if (!players.length) return "";

  const rows = players
    .map((p, i) => {
      const pts = scores[p.name] || 0;
      return `
        <div class="game-scores-box__row">
          <span class="game-scores-box__rank">${i + 1}</span>
          <div class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</div>
          <span class="player-name game-scores-box__name">${escapeHtml(p.name)}</span>
          <span class="player-score ${i === 0 ? "player-score--gold" : ""}">${pts}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="card game-scores-box">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      ${gameLabel ? `<p class="game-scores-box__game">${escapeHtml(gameLabel)}</p>` : ""}
      ${rows}
    </div>`;
}
