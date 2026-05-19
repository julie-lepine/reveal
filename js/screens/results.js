import { getEveningRecap } from "../core/eveningRecap.js";
import { getLastGame } from "../core/state.js";
import { getLobbyStatus, getLobbyGameId } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountResults(app) {
  if (!requireLobbyPlay()) return null;

  const recap = getEveningRecap();
  const last = getLastGame();
  const status = getLobbyStatus();
  const gameId = getLobbyGameId();

  const lastBlock = last
    ? `
    <div class="card card--highlight">
      <p class="card-heading">Dernière partie</p>
      <p class="evening-recap__title">${escapeHtml(last.title || last.gameId)}</p>
      <p class="hint">${escapeHtml(last.summary || "")}</p>
    </div>`
    : `<p class="hint">Aucune partie récente.</p>`;

  const chips = [
    recap.hotTakes > 0 ? `<span class="evening-recap__chip">🔥 ${recap.hotTakes}</span>` : "",
    recap.liesTotal > 0
      ? `<span class="evening-recap__chip">🕵️ ${recap.liesFound}/${recap.liesTotal}</span>`
      : "",
    recap.tierNights > 0 ? `<span class="evening-recap__chip">🏆 ${recap.tierNights}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  app.innerHTML = pageShell({
    backTarget: "game-select",
    content: `
      <p class="label-upper label-upper--gold">📊 Résultats</p>
      <h2 class="screen-title">Récap de la soirée</h2>
      <p class="hint lobby-status-hint">Lobby : ${status === "playing" ? `en jeu (${gameId || "—"})` : "en attente"}</p>

      ${lastBlock}

      <div class="evening-recap card">
        <p class="evening-recap__title">Stats globales</p>
        <div class="evening-recap__chips">${chips || '<span class="hint">Lance un jeu !</span>'}</div>
        ${
          recap.top[0]
            ? `<p class="evening-recap__meta">En tête : <strong>${escapeHtml(recap.top[0].name)}</strong> — ${recap.top[0].score} pts</p>`
            : ""
        }
      </div>

      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-nav="game-select">Autre jeu</button>
        <button type="button" class="btn btn-secondary" data-nav="leaderboard">Classement</button>
      </div>
    `,
  });

  bindNav(app, {
    leaderboard: () => {
      navigate("leaderboard", {
        navStack: ["home", "lobby", "game-select", "results", "leaderboard"],
      });
    },
  });
  return null;
}
