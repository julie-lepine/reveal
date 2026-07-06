import { getEveningRecap } from "../core/eveningRecap.js";
import { getLobbyStatus, getLobbyGameId } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { getCurrentScreen } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import {
  eveningRecapRestartButtonHtml,
  bindRestartGameButtons,
  resolveLastGameForRestart,
} from "../core/restartGame.js";
import { eveningGameLeaderboardsHtml } from "../core/gameScores.js";
import { formatPlayerWithBadge } from "../core/badges.js";
import {
  isGameSyncActive,
  isSessionRouteSuppressed,
  onGameSessionChange,
  refreshEveningScoresFromSession,
  tryFollowHostGameSession,
  routeToActiveGameIfNeeded,
  isLobbyHost,
} from "../core/gameSync.js";
import { refreshLobbyFromSupabase, onLobbyBundleUpdated } from "../core/supabaseLobby.js";

export function mountResults(app) {
  if (!requireLobbyPlay()) return null;

  function render() {
    const recap = getEveningRecap();
    const last = resolveLastGameForRestart();
    const status = getLobbyStatus();
    const gameId = getLobbyGameId();

    const lastBlock = last
      ? `
    <div class="card card--highlight">
      <p class="card-heading">Dernière partie</p>
      <p class="evening-recap__title">${escapeHtml(last.title || last.gameId)}</p>
      <p class="hint">${escapeHtml(last.summary || "")}</p>
      ${eveningRecapRestartButtonHtml(last)}
    </div>`
      : `<p class="hint">Aucune partie récente.</p>`;

    const chips = [
      recap.hotTakes > 0 ? `<span class="evening-recap__chip">🔥 ${recap.hotTakes}</span>` : "",
      recap.liesTotal > 0
        ? `<span class="evening-recap__chip">🕵️ ${recap.liesFound}/${recap.liesTotal}</span>`
        : "",
      recap.speedVotes > 0 ? `<span class="evening-recap__chip">⚡ ${recap.speedVotes}</span>` : "",
      recap.triviaGames > 0 ? `<span class="evening-recap__chip">🧠 ${recap.triviaGames}</span>` : "",
      recap.truthMeters > 0 ? `<span class="evening-recap__chip">📏 ${recap.truthMeters}</span>` : "",
      recap.consensusGames > 0 ? `<span class="evening-recap__chip">🤝 ${recap.consensusGames}</span>` : "",
      recap.tierNights > 0 ? `<span class="evening-recap__chip">🏆 ${recap.tierNights}</span>` : "",
    ]
      .filter(Boolean)
      .join("");

    app.innerHTML = pageShell({
      backTarget: "game-select",
      content: `
      <p class="label-upper label-upper--gold">📊 Résultats</p>
      <h2 class="screen-title">Récap de la soirée</h2>
      <p class="hint lobby-status-hint">Lobby : ${status === "playing" ? `en jeu (${gameId || "-"})` : "en attente"}</p>

      ${lastBlock}

      <div class="evening-recap card">
        <p class="evening-recap__title">Stats globales</p>
        <div class="evening-recap__chips">${chips || '<span class="hint">Lance un jeu !</span>'}</div>
        ${
          recap.top[0]
            ? `<p class="evening-recap__meta">En tête : <strong>${escapeHtml(formatPlayerWithBadge(recap.top[0].name))}</strong> — ${recap.top[0].score} pts</p>`
            : ""
        }
      </div>

      ${eveningGameLeaderboardsHtml()}

      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-nav="game-select">Autre jeu</button>
        <button type="button" class="btn btn-accent" data-nav="leaderboard">Classement</button>
      </div>
    `,
    });

    bindNav(app);
    bindRestartGameButtons(app);
  }

  let unsubSession = () => {};
  let unsubLobby = () => {};

  if (isGameSyncActive()) {
    render();
    void (async () => {
      await refreshLobbyFromSupabase();
      await refreshEveningScoresFromSession();
      if (getCurrentScreen() === "results") render();
    })();
    unsubSession = onGameSessionChange((row) => {
      tryFollowHostGameSession(row);
      if (getCurrentScreen() === "results") render();
    });
    unsubLobby = onLobbyBundleUpdated(() => {
      if (
        !isLobbyHost() &&
        !isSessionRouteSuppressed() &&
        getLobbyStatus() === "playing"
      ) {
        const gid = getLobbyGameId();
        if (gid && gid !== "menu") void routeToActiveGameIfNeeded();
      }
      if (getCurrentScreen() === "results") render();
    });
  } else {
    render();
  }

  return () => {
    unsubSession();
    unsubLobby();
  };
}
