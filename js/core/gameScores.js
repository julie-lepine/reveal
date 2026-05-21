import { getSortedActivePlayers } from "./players.js";
import { getState } from "./state.js";
import { escapeHtml } from "./ui.js";

function gameScoresBoxRowsHtml(players, scores) {
  return players
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
}

/** Points consensus de la manche Tier Night (tous les joueurs). */
export function tierNightRoundScoresHtml(recaps, { title = "Points de la manche" } = {}) {
  if (!recaps?.length) return "";
  const sorted = [...recaps].sort((a, b) => (b.consensusPoints ?? 0) - (a.consensusPoints ?? 0));
  const rows = sorted
    .map((r, i) => {
      const pts = r.consensusPoints ?? 0;
      return `
        <div class="game-scores-box__row">
          <span class="game-scores-box__rank">${i + 1}</span>
          <div class="avatar avatar--sm" style="background:${r.color}">${r.emoji}</div>
          <span class="player-name game-scores-box__name">${escapeHtml(r.player)}</span>
          <span class="player-score ${i === 0 ? "player-score--gold" : ""}">+${pts}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="card game-scores-box game-scores-box--round" data-scores="round">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      <p class="game-scores-box__game">Proximité au consensus du groupe</p>
      ${rows}
    </div>`;
}

/** Boîte de cumul des scores (soirée) affichée en fin de manche. */
export function gameCumulativeScoresHtml({ gameLabel = null, title = "Cumul des scores" } = {}) {
  const { scores } = getState();
  const players = getSortedActivePlayers();
  if (!players.length) return "";

  return `
    <div class="card game-scores-box" data-scores="evening">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      ${gameLabel ? `<p class="game-scores-box__game">${escapeHtml(gameLabel)}</p>` : ""}
      ${gameScoresBoxRowsHtml(players, scores)}
    </div>`;
}

/** Met à jour le cumul des scores sans re-render tout l’écran (sync multijoueur). */
export function refreshGameScoresBox(app, { gameLabel = null, title = "Cumul des scores" } = {}) {
  if (!app) return;
  const { scores } = getState();
  const players = getSortedActivePlayers();
  if (!players.length) return;

  const box = app.querySelector('[data-scores="evening"]');
  if (!box) return;

  const titleEl = box.querySelector(".game-scores-box__title");
  const gameEl = box.querySelector(".game-scores-box__game");
  if (titleEl) titleEl.textContent = title;
  if (gameEl) gameEl.textContent = gameLabel || "";
  else if (gameLabel) {
    box.insertAdjacentHTML(
      "afterbegin",
      `<p class="game-scores-box__game">${escapeHtml(gameLabel)}</p>`
    );
  }

  const oldRows = box.querySelectorAll(".game-scores-box__row");
  oldRows.forEach((el) => el.remove());
  const anchor = box.querySelector(".game-scores-box__game") || titleEl;
  if (anchor) {
    anchor.insertAdjacentHTML("afterend", gameScoresBoxRowsHtml(players, scores));
  } else {
    box.insertAdjacentHTML("beforeend", gameScoresBoxRowsHtml(players, scores));
  }
}
