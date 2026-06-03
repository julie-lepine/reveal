import { GAMES_AVAILABLE } from "../../data/games.js";
import { RULES_KEY_BY_NAV } from "../../data/gameRules.js";
import { rulesIconButtonHtml } from "../core/gameRulesUi.js";
import { getEveningRecap } from "../core/eveningRecap.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import {
  escapeHtml,
  pageShell,
  gameTileVisualHtml,
  bindGameTileLogos,
} from "../core/ui.js";
import { handleNavTarget, goToEveningSettings } from "./nav.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  handleSessionRoute,
  refreshGameSession,
  // refreshFilRougeFromSession,
  getCachedGameSession,
  routeToActiveGameIfNeeded,
} from "../core/gameSync.js";
import { navigate, getCurrentScreen } from "../core/router.js";
import { isSupabaseConfigured } from "../core/supabaseClient.js";
import { startLobbyPresenceSync } from "../core/supabaseLobby.js";
import { hasActiveLobby } from "../core/lobby.js";
import { getLastGame, getState } from "../core/state.js";
// import { getFilRougeSession } from "../core/filRougeSession.js";
import {
  launchSpeedVotePrep,
  launchPlaylistGuessPrep,
  launchTriviaPrep,
  launchTruthMeterPrep,
  launchConsensusPrep,
  launchDilemmaPrep,
  launchHotTakePrep,
  launchGuessLieMenu,
  launchTierNightSelect,
  eveningRecapRestartButtonHtml,
  restartGame,
} from "../core/restartGame.js";
// FIL_ROUGE (Mot interdit) — désactivé
// import {
//   filRougeGameSelectSectionHtml,
//   bindFilRougeBox,
//   registerFilRougeRefresh,
// } from "../core/filRougeUi.js";

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
    recap.playlistGuesses > 0
      ? `<span class="evening-recap__chip">🎶 ${recap.playlistGuesses} playlist${recap.playlistGuesses > 1 ? "s" : ""}</span>`
      : "",
    recap.triviaGames > 0
      ? `<span class="evening-recap__chip">🧠 ${recap.triviaGames} Trivia${recap.triviaGames > 1 ? "s" : ""}</span>`
      : "",
    recap.truthMeters > 0
      ? `<span class="evening-recap__chip">📏 ${recap.truthMeters} TruthMeter${recap.truthMeters > 1 ? "s" : ""}</span>`
      : "",
    recap.consensusGames > 0
      ? `<span class="evening-recap__chip">🤝 ${recap.consensusGames} Consensus${recap.consensusGames > 1 ? "s" : ""}</span>`
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
        <span>En tête : <strong>${escapeHtml(recap.top[0].name)}</strong> - ${recap.top[0].score} pts</span>
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

function buildGameSelectHandlers() {
  return {
    "speedvote-prep": launchSpeedVotePrep,
    "playlistguess-prep": launchPlaylistGuessPrep,
    "trivia-prep": launchTriviaPrep,
    "truthmeter-prep": launchTruthMeterPrep,
    "consensus-prep": launchConsensusPrep,
    "dilemma-prep": launchDilemmaPrep,
    "hottake-prep": launchHotTakePrep,
    guesslie: launchGuessLieMenu,
    "tiernight-select": launchTierNightSelect,
    settings: () => goToEveningSettings(),
    leaderboard: () => {
      navigate("leaderboard", {
        navStack: ["home", "lobby", "game-select", "leaderboard"],
      });
    },
  };
}

function gameTileMarkup(g) {
  const visual = gameTileVisualHtml(g);
  const badge = escapeHtml(g.badgeLabel || "Bientôt");

  if (!g.enabled) {
    return `
      <div class="game-tile game-tile--disabled ${escapeHtml(g.cssClass)}" aria-disabled="true">
        ${visual}
        <div class="game-tile__text">
          <span class="game-tile__title">${escapeHtml(g.title)}</span>
          <span class="game-tile__desc">${escapeHtml(g.desc)}</span>
          <span class="badge badge--soon">${badge}</span>
        </div>
      </div>`;
  }

  const rulesKey = RULES_KEY_BY_NAV[g.id];
  return `
    <div class="game-tile-cell">
      <button type="button" class="game-tile ${escapeHtml(g.cssClass)}" data-nav="${escapeHtml(g.id)}">
        ${visual}
        <div class="game-tile__text">
          <span class="game-tile__title">${escapeHtml(g.title)}</span>
          <span class="game-tile__desc">${escapeHtml(g.desc)}</span>
        </div>
      </button>
      ${rulesKey ? rulesIconButtonHtml(rulesKey) : ""}
    </div>`;
}

function gameGridSection(label, games) {
  if (!games.length) return "";
  return `
    <p class="game-grid__label">${escapeHtml(label)}</p>
    <div class="game-grid">
      ${games.map((g) => gameTileMarkup(g)).join("")}
    </div>`;
}

function gameSelectRenderSnapshot() {
  const recap = getEveningRecap();
  const participants = getState().lobby?.participants || [];
  return JSON.stringify({
    n: participants.length,
    recap: recap.hasActivity,
    ht: recap.hotTakes,
    sv: recap.speedVotes,
    tq: recap.triviaGames,
    tm: recap.truthMeters,
    cs: recap.consensusGames,
    dl: recap.dilemmas,
    lastGame: getLastGame()?.gameId ?? null,
  });
}

export function mountGameSelect(app) {
  if (!requireLobbyPlay()) return null;

  let unsubSession = () => {};
  let renderTimer = null;
  let renderInFlight = false;
  let lastSnapshot = "";
  const navHandlers = buildGameSelectHandlers();

  function onGameSelectClick(e) {
    if (getCurrentScreen() !== "game-select") return;

    const restartEl = e.target.closest("[data-restart-game]");
    if (restartEl) {
      void restartGame(restartEl.getAttribute("data-restart-game"));
      return;
    }

    const navEl = e.target.closest("[data-nav]");
    if (navEl) {
      void handleNavTarget(navEl.getAttribute("data-nav"), navHandlers);
    }
  }

  app.addEventListener("click", onGameSelectClick);

  function bindGameSelectEvents() {
    bindGameTileLogos(app);
    // bindFilRougeBox(app);
  }

  function scheduleRender(force = false) {
    if (renderTimer) clearTimeout(renderTimer);
    const delay = force ? 0 : 300;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      void renderIfNeeded(force);
    }, delay);
  }

  async function renderIfNeeded(force = false) {
    const snap = gameSelectRenderSnapshot();
    if (!force && snap === lastSnapshot) return;
    if (renderInFlight) {
      scheduleRender(false);
      return;
    }
    renderInFlight = true;
    try {
      await render();
      lastSnapshot = snap;
    } finally {
      renderInFlight = false;
    }
  }

  async function render() {
    const recap = getEveningRecap();
    app.innerHTML = pageShell({
      backTarget: "home",
      content: `
      <p class="label-upper label-upper--gold">🎮 La soirée</p>
      <h2 class="screen-title">Choisir un jeu</h2>
      <p class="game-intro">Sélectionne une activité pour le lobby.</p>
      <button type="button" class="btn-link game-select-profile" data-nav="settings">Profil & paramètres</button>

      ${eveningRecapHtml(recap)}

      ${gameGridSection("🎮 Jeux disponibles", GAMES_AVAILABLE)}
    `,
    });

    bindGameSelectEvents();
  }

  // registerFilRougeRefresh(() => scheduleRender(true));
  scheduleRender(true);

  if (isSupabaseConfigured() && hasActiveLobby()) {
    startLobbyPresenceSync();
  }

  if (isGameSyncActive()) {
    void (async () => {
      if (await routeToActiveGameIfNeeded()) return;
      const row = getCachedGameSession() ?? (await refreshGameSession());
      if (row) handleSessionRoute(row);
      scheduleRender(true);
    })();

    unsubSession = onGameSessionChange(async (row) => {
      if (row && (await routeToActiveGameIfNeeded(row))) return;
      if (row) handleSessionRoute(row);
    });
  }

  return () => {
    // registerFilRougeRefresh(null);
    app.removeEventListener("click", onGameSelectClick);
    unsubSession();
    if (renderTimer) clearTimeout(renderTimer);
  };
}
