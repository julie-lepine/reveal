import { getState } from "../core/state.js";
import { getPlayerBadges } from "../core/badges.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { isGameSyncActive, refreshEveningScoresFromSession } from "../core/gameSync.js";

export function mountLeaderboard(app) {
  function renderBoard() {
    const { scores } = getState();
    const sorted = getPlayerBadges();
    const podium = [sorted[1], sorted[0], sorted[2]].filter(Boolean);

    app.innerHTML = pageShell({
    content: `
      <p class="label-upper label-upper--gold">Fin de manche</p>
      <div class="logo logo--sm"><h1>CLASSEMENT</h1></div>

      <div class="podium">
        ${podium
          .map((p, i) => {
            const heights = [90, 120, 70];
            const labels = ["2e", "1er", "3e"];
            const isFirst = i === 1;
            return `
              <div class="podium__col ${isFirst ? "podium__col--first" : ""}">
                <div class="avatar avatar--md" style="background:${p.color}">${p.emoji}</div>
                <span class="podium__name">${escapeHtml(p.name)}</span>
                <div class="podium__bar" style="height:${heights[i]}px">
                  <span class="podium__rank">${labels[i]}</span>
                  <span class="podium__score">${scores[p.name] || 0}</span>
                </div>
              </div>`;
          })
          .join("")}
      </div>

      <div class="card">
        ${sorted
          .map(
            (p, i) => `
          <div class="player-row player-row--list">
            <span class="rank ${i === 0 ? "rank--gold" : ""}">${i + 1}</span>
            <div class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</div>
            <div class="player-row__info">
              <span class="player-name">${escapeHtml(p.name)}</span>
              <span class="player-badge">${escapeHtml(p.badge || "")}</span>
            </div>
            <span class="player-score ${i === 0 ? "player-score--gold" : ""}">${scores[p.name] || 0}</span>
          </div>`
          )
          .join("")}
      </div>

      <div class="btn-row">
        <button type="button" class="btn btn-accent" data-nav="results">Résultats</button>
        <button type="button" class="btn btn-primary" data-nav="game-select">Autre jeu</button>
      </div>
    `,
    });

    bindNav(app, {
      results: () => {
        navigate("results", {
          navStack: ["home", "lobby", "game-select", "results"],
        });
      },
    });
  }

  renderBoard();

  if (isGameSyncActive()) {
    void refreshEveningScoresFromSession().then(() => renderBoard());
  }

  return null;
}
