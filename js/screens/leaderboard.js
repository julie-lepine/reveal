import { getState } from "../core/state.js";
import { getPlayerBadges } from "../core/badges.js";
import { getCurrentScreen } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import {
  isGameSyncActive,
  refreshEveningScoresFromSession,
  onGameSessionChange,
  routeToActiveGameIfNeeded,
  tryFollowHostGameSession,
} from "../core/gameSync.js";
import { formatSyncErrorMessage } from "../core/authErrors.js";
import {
  competitionRankLabel,
  formatCoLeadersHint,
  winnersAtRank,
  sortAndRankByScore,
} from "../core/competitionRank.js";

export function mountLeaderboard(app) {
  function renderBoard() {
    const { scores } = getState();
    // Badges déjà attribués via getSortedActivePlayers (score seul).
    // Re-tri affichage local : nom uniquement pour ordre stable entre ex æquo.
    const ranked = sortAndRankByScore(getPlayerBadges(), (p) => scores[p.name] || 0);
    const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
    const leaders = winnersAtRank(ranked, 1);
    const tieHintText = formatCoLeadersHint(leaders);
    const tieHint = tieHintText
      ? `<p class="hint podium__tie-hint">👑 ${escapeHtml(tieHintText)}</p>`
      : "";

    app.innerHTML = pageShell({
    content: `
      <p class="label-upper label-upper--gold">Fin de manche</p>
      <div class="logo logo--sm"><h1>CLASSEMENT</h1></div>
      ${tieHint}

      <div class="podium">
        ${podium
          .map((p) => {
            const isFirst = p.rank === 1;
            const height = p.rank === 1 ? 120 : p.rank === 2 ? 90 : 70;
            return `
              <div class="podium__col ${isFirst ? "podium__col--first" : ""}">
                <div class="avatar avatar--md" style="background:${p.color}">${p.emoji}</div>
                <span class="podium__name">${escapeHtml(p.name)}</span>
                ${p.badge ? `<span class="podium__badge hint">${escapeHtml(p.badge)}</span>` : ""}
                <div class="podium__bar" style="height:${height}px">
                  <span class="podium__rank">${competitionRankLabel(p.rank)}</span>
                  <span class="podium__score">${scores[p.name] || 0}</span>
                </div>
              </div>`;
          })
          .join("")}
      </div>

      <div class="card">
        ${ranked
          .map(
            (p) => `
          <div class="player-row player-row--list">
            <span class="rank ${p.rank === 1 ? "rank--gold" : ""}">${p.rank}</span>
            <div class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</div>
            <div class="player-row__info">
              <span class="player-name">${escapeHtml(p.name)}</span>
              <span class="player-badge">${escapeHtml(p.badge || "")}</span>
            </div>
            <span class="player-score ${p.rank === 1 ? "player-score--gold" : ""}">${scores[p.name] || 0}</span>
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

    bindNav(app);
  }

  let unsubSession = () => {};
  if (isGameSyncActive()) {
    renderBoard();
    void refreshEveningScoresFromSession()
      .then(() => {
        if (getCurrentScreen() === "leaderboard") renderBoard();
      })
      .catch(async (err) => {
        console.warn("REVEAL leaderboard refresh:", err);
        const { showAppAlert } = await import("../core/dialog.js");
        await showAppAlert(formatSyncErrorMessage(err?.message), {
          title: "Connexion",
          icon: "📡",
        });
      });
    unsubSession = onGameSessionChange(async (row) => {
      if (!row) return;
      if (tryFollowHostGameSession(row)) return;
      if (await routeToActiveGameIfNeeded(row)) return;
      if (getCurrentScreen() === "leaderboard") renderBoard();
    });
  } else {
    renderBoard();
  }

  return () => {
    unsubSession();
  };
}
