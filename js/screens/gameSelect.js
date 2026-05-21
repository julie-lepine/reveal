import { GAMES } from "../../data/games.js";
import { getEveningRecap } from "../core/eveningRecap.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { escapeHtml, pageShell, gameTileLogoHtml, bindGameTileLogos } from "../core/ui.js";
import { bindNav, goToEveningSettings } from "./nav.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  handleSessionRoute,
  refreshGameSession,
  getCachedGameSession,
  routeToActiveGameIfNeeded,
} from "../core/gameSync.js";
import { navigate, getCurrentScreen } from "../core/router.js";
import { getLastGame } from "../core/state.js";
import {
  launchSpeedVotePrep,
  launchTruthMeterPrep,
  launchDilemmaPrep,
  launchHotTakePrep,
  launchGuessLieMenu,
  launchTierNightSelect,
  eveningRecapRestartButtonHtml,
  bindRestartGameButtons,
} from "../core/restartGame.js";

function eveningRecapHtml(recap) {
  if (!recap.hasActivity) {
    return `
      <div class="evening-recap evening-recap--empty card">
        <p class="evening-recap__title">📋 Récap de la soirée</p>
        <p class="evening-recap__empty">La soirée commence… lance un premier jeu !</p>
        <p class="evening-recap__meta">${recap.participantCount} joueur(s) dans le lobby</p>
      </div>`;
  }

  const chips = [
    recap.hotTakes > 0
      ? `<span class="evening-recap__chip">🔥 ${recap.hotTakes} hot take${recap.hotTakes > 1 ? "s" : ""}</span>`
      : "",
    recap.liesTotal > 0
      ? `<span class="evening-recap__chip">🕵️ ${recap.liesFound}/${recap.liesTotal} mensonges · ${recap.lieRate}</span>`
      : "",
    recap.speedVotes > 0
      ? `<span class="evening-recap__chip">⚡ ${recap.speedVotes} SpeedVote${recap.speedVotes > 1 ? "s" : ""}</span>`
      : "",
    recap.truthMeters > 0
      ? `<span class="evening-recap__chip">📏 ${recap.truthMeters} TruthMeter${recap.truthMeters > 1 ? "s" : ""}</span>`
      : "",
    recap.dilemmas > 0
      ? `<span class="evening-recap__chip">⚖️ ${recap.dilemmas} Dilemma${recap.dilemmas > 1 ? "s" : ""}</span>`
      : "",
    recap.tierNights > 0
      ? `<span class="evening-recap__chip">🏆 ${recap.tierNights} tier list${recap.tierNights > 1 ? "s" : ""}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const leader = recap.top[0]
    ? `<div class="evening-recap__leader">
        <span class="evening-recap__leader-avatar" style="background:${recap.top[0].color}">${recap.top[0].emoji}</span>
        <span>En tête : <strong>${escapeHtml(recap.top[0].name)}</strong> — ${recap.top[0].score} pts</span>
      </div>`
    : "";

  const lastTier = recap.lastTier
    ? `<p class="evening-recap__last">Dernière tier : « ${escapeHtml(recap.lastTier)} »</p>`
    : "";

  const moreLink = recap.top.length
    ? `<button type="button" class="evening-recap__link" data-nav="leaderboard">Voir le classement →</button>`
    : "";

  const last = getLastGame();
  const restartBtn = eveningRecapRestartButtonHtml(last);

  return `
    <div class="evening-recap card">
      <p class="evening-recap__title">📋 Récap de la soirée</p>
      <div class="evening-recap__chips">${chips}</div>
      ${leader}
      ${lastTier}
      ${restartBtn}
      ${moreLink}
    </div>`;
}

export function mountGameSelect(app) {
  if (!requireLobbyPlay()) return null;

  let unsubSession = () => {};
  let guestRoutePoll = null;

  function bindGameSelectEvents() {
    const mpHandlers = {};
    if (isGameSyncActive()) {
      mpHandlers["speedvote-prep"] = launchSpeedVotePrep;
      mpHandlers["truthmeter-prep"] = launchTruthMeterPrep;
      mpHandlers["dilemma-prep"] = launchDilemmaPrep;
      mpHandlers["hottake-prep"] = launchHotTakePrep;
      mpHandlers.guesslie = launchGuessLieMenu;
      mpHandlers["tiernight-select"] = launchTierNightSelect;
    }

    bindNav(app, {
      ...mpHandlers,
      "speedvote-prep": launchSpeedVotePrep,
      "truthmeter-prep": launchTruthMeterPrep,
      "dilemma-prep": launchDilemmaPrep,
      settings: () => goToEveningSettings(),
      leaderboard: () => {
        navigate("leaderboard", {
          navStack: ["home", "lobby", "game-select", "leaderboard"],
        });
      },
    });
    bindGameTileLogos(app);
    bindRestartGameButtons(app);
  }

  function render() {
    const recap = getEveningRecap();

    app.innerHTML = pageShell({
      backTarget: "lobby",
      content: `
      <p class="label-upper label-upper--gold">🎮 La soirée</p>
      <h2 class="screen-title">Choisir un jeu</h2>
      <p class="game-intro">Sélectionne une activité pour le lobby.</p>
      <button type="button" class="btn-link game-select-profile" data-nav="settings">Profil & paramètres</button>

      ${eveningRecapHtml(recap)}

      <div class="game-grid">
        ${GAMES.map((g) => {
          if (!g.enabled) {
            return `
              <div class="game-tile game-tile--disabled ${g.cssClass}">
                <span class="game-tile__emoji">${g.emoji}</span>
                <div class="game-tile__meta">
                  <span class="game-tile__title">${escapeHtml(g.title)}</span>
                  <span class="badge badge--soon">Soon</span>
                </div>
              </div>`;
          }
          return `
            <button type="button" class="game-tile ${g.cssClass}" data-nav="${g.id}">
              ${g.logo ? gameTileLogoHtml(g) : `<span class="game-tile__emoji">${g.emoji}</span>`}
              <div class="game-tile__text">
                <span class="game-tile__title">${escapeHtml(g.title)}</span>
                <span class="game-tile__desc">${escapeHtml(g.desc)}</span>
              </div>
            </button>`;
        }).join("")}
      </div>
    `,
    });

    bindGameSelectEvents();
  }

  render();

  if (isGameSyncActive()) {
    void (async () => {
      if (await routeToActiveGameIfNeeded()) return;
      const row = (await refreshGameSession()) || getCachedGameSession();
      if (row) handleSessionRoute(row);
      render();
    })();

    unsubSession = onGameSessionChange(async (row) => {
      if (getCurrentScreen() === "game-select") render();
      if (row && (await routeToActiveGameIfNeeded())) return;
      if (row) handleSessionRoute(row);
    });

    if (!isLobbyHost()) {
      guestRoutePoll = setInterval(async () => {
        if (await routeToActiveGameIfNeeded()) return;
        if (getCurrentScreen() !== "game-select") return;
        const row = (await refreshGameSession()) || getCachedGameSession();
        if (row) handleSessionRoute(row);
      }, 1000);
    }
  }

  return () => {
    unsubSession();
    if (guestRoutePoll) clearInterval(guestRoutePoll);
  };
}
