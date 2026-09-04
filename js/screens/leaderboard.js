import { getState } from "../core/state.js";
import { getPlayerBadges } from "../core/badges.js";
import { getSortedEveningStandingPlayers } from "../core/players.js";
import { getCurrentScreen } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { playerAvatarHtml, playerNameHtml } from "../core/signatureUi.js";
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
    // UX-HIST-01 : standings soirée (actifs + contributeurs partis).
    // Badges : uniquement ceux déjà calculés pour les actifs - pas de filtre de ligne.
    const badgeByName = Object.fromEntries(
      getPlayerBadges().map((p) => [p.name, p.badge || ""])
    );
    const standings = getSortedEveningStandingPlayers().map((p) => ({
      ...p,
      badge: badgeByName[p.name] || "",
      score: scores[p.name] || 0,
    }));
    const ranked = sortAndRankByScore(standings, (p) => p.score);
    const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
    const leaders = winnersAtRank(ranked, 1);
    const tieHintText = formatCoLeadersHint(leaders);
    const tieHint = tieHintText
      ? `<p class="hint podium__tie-hint">👑 ${escapeHtml(tieHintText)}</p>`
      : "";

    app.innerHTML = pageShell({
    content: `
      <p class="label-upper label-upper--gold">🏆 Fin de manche</p>
      <h2 class="screen-title">Podium de la soirée</h2>
      ${tieHint}

      <div class="podium">
        ${podium
          .map((p) => {
            const isFirst = p.rank === 1;
            const height = p.rank === 1 ? 120 : p.rank === 2 ? 90 : 70;
            return `
              <div class="podium__col ${isFirst ? "podium__col--first" : ""}">
                ${playerAvatarHtml(p, "avatar avatar--md")}
                ${playerNameHtml(p, "podium__name")}
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
            ${playerAvatarHtml(p)}
            <div class="player-row__info">
              ${playerNameHtml(p)}
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
