import { GAMES_AVAILABLE, GAMES_COMING_SOON } from "../../data/games.js";
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
import { getCurrentScreen } from "../core/router.js";
import { isSupabaseConfigured } from "../core/supabaseClient.js";
import { startLobbyPresenceSync, onLobbyBundleUpdated } from "../core/supabaseLobby.js";
import { hasActiveLobby, transferLobbyHost } from "../core/lobby.js";
import { getLastGame, getState } from "../core/state.js";
// import { getFilRougeSession } from "../core/filRougeSession.js";
import { bindFeedbackPrompt, feedbackPromptCardHtml } from "../core/feedbackUi.js";
import {
  bindGameResumeBanner,
  gameResumeBannerHtml,
  getResumableSessionScreen,
  shouldShowGameSelectResumeBanner,
} from "../core/gameResume.js";
import {
  launchTraitrePrep,
  launchSpeedVotePrep,
  launchClutchPrep,
  launchWrongAnswerPrep,
  launchPlaylistGuessPrep,
  launchTriviaPrep,
  launchTruthMeterPrep,
  launchConsensusPrep,
  launchDilemmaPrep,
  launchHotTakePrep,
  launchGuessLieMenu,
  launchTierNightSelect,
  eveningRecapRestartButtonHtml,
  resolveLastGameForRestart,
  restartGame,
} from "../core/restartGame.js";
// FIL_ROUGE (Mot interdit) - désactivé
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
    recap.traitreGames > 0
      ? `<span class="evening-recap__chip">🎭 ${recap.traitreGames} Spot the fake</span>`
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

  const restartBtn = eveningRecapRestartButtonHtml(resolveLastGameForRestart());

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
    "traitre-prep": launchTraitrePrep,
    "speedvote-prep": launchSpeedVotePrep,
    "clutch-prep": launchClutchPrep,
    "wronganswer-prep": launchWrongAnswerPrep,
    "playlistguess-prep": launchPlaylistGuessPrep,
    "trivia-prep": launchTriviaPrep,
    "truthmeter-prep": launchTruthMeterPrep,
    "consensus-prep": launchConsensusPrep,
    "dilemma-prep": launchDilemmaPrep,
    "hottake-prep": launchHotTakePrep,
    guesslie: launchGuessLieMenu,
    "tiernight-select": launchTierNightSelect,
    settings: () => goToEveningSettings(),
  };
}

function gameTileMarkup(g) {
  const visual = gameTileVisualHtml(g);
  const badge = escapeHtml(g.badgeLabel || "Bientôt");

  const rulesKey = RULES_KEY_BY_NAV[g.id];

  if (!g.enabled) {
    return `
      <div class="game-tile-cell">
        <div class="game-tile game-tile--disabled ${escapeHtml(g.cssClass)}" aria-disabled="true">
          ${visual}
          <div class="game-tile__text">
            <span class="game-tile__title">${escapeHtml(g.title)}</span>
            <span class="game-tile__desc">${escapeHtml(g.desc)}</span>
            <span class="badge badge--soon">${badge}</span>
          </div>
        </div>
        ${rulesKey ? rulesIconButtonHtml(rulesKey) : ""}
      </div>`;
  }

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
  const hostId = getState().lobby?.hostId || "";
  // Inclure l'état du bandeau « Rejoindre la partie en cours » : sinon un render
  // non forcé l'ignorerait (la session est hors lobby state) et on devait forcer
  // un innerHTML complet à chaque notif lobby. En le capturant, scheduleRender(false)
  // suffit : on ne re-render que quand le bandeau apparaît/disparaît réellement.
  const resumeScreen = getResumableSessionScreen(getCachedGameSession());
  const resume = shouldShowGameSelectResumeBanner(resumeScreen) ? resumeScreen : null;
  return JSON.stringify({
    n: participants.length,
    hostId,
    recap: recap.hasActivity,
    ht: recap.hotTakes,
    sv: recap.speedVotes,
    tq: recap.triviaGames,
    tm: recap.truthMeters,
    cs: recap.consensusGames,
    dl: recap.dilemmas,
    lastGame: getLastGame()?.gameId ?? null,
    resume,
  });
}

function transferHostButtonHtml() {
  if (!isGameSyncActive() || !isLobbyHost()) return "";
  const others = (getState().lobby?.participants || []).filter((p) => !p.isLocal);
  if (!others.length) return "";
  return `
    <button type="button" class="btn btn-secondary game-select-transfer-host" data-transfer-host>
      👑 Transférer l'hôte
    </button>`;
}

export function mountGameSelect(app) {
  if (!requireLobbyPlay()) return null;

  app.innerHTML = pageShell({
    backTarget: "home",
    content: `<p class="hint">Chargement…</p>`,
  });

  let unsubSession = () => {};
  let unsubResumeBanner = () => {};
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

    if (e.target.closest("[data-transfer-host]")) {
      void transferLobbyHost().then((res) => {
        if (res.ok) scheduleRender(true);
      });
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
    const resumeScreen = getResumableSessionScreen(getCachedGameSession());
    const resumeBanner =
      shouldShowGameSelectResumeBanner(resumeScreen) ? gameResumeBannerHtml(resumeScreen) : "";

    app.innerHTML = pageShell({
      backTarget: "home",
      content: `
      ${resumeBanner}
      <p class="label-upper label-upper--gold">🎮 La soirée</p>
      <h2 class="screen-title">Choisir un jeu</h2>
      <p class="game-intro">Sélectionne une activité pour le lobby.</p>
      <button type="button" class="btn-link game-select-profile" data-nav="settings">Profil & paramètres</button>
      ${transferHostButtonHtml()}

      ${eveningRecapHtml(recap)}

      ${gameGridSection("🎮 Jeux disponibles", GAMES_AVAILABLE)}
      ${gameGridSection("🔜 Prochainement", GAMES_COMING_SOON)}

      ${feedbackPromptCardHtml()}
    `,
    });

    unsubResumeBanner();
    if (resumeScreen && shouldShowGameSelectResumeBanner(resumeScreen)) {
      unsubResumeBanner = bindGameResumeBanner(app, resumeScreen);
    }

    bindGameSelectEvents();
    bindFeedbackPrompt(app);
  }

  // registerFilRougeRefresh(() => scheduleRender(true));
  scheduleRender(true);

  if (isSupabaseConfigured() && hasActiveLobby()) {
    startLobbyPresenceSync();
  }

  const unsubLobby = onLobbyBundleUpdated(() => {
    // Quand l'hôte (re)lance un jeu, la maj lobby (status playing / game_id) arrive
    // souvent avant la nouvelle ligne de session. On refetch la session pour que le
    // bandeau « Rejoindre la partie en cours » apparaisse aussitôt, sans repasser par
    // l'Accueil. scheduleRender(false) : le snapshot inclut désormais l'état du bandeau,
    // donc on ne re-render que si quelque chose a réellement changé (plus de innerHTML
    // complet forcé à chaque notif lobby).
    if (isGameSyncActive()) {
      void (async () => {
        await refreshGameSession();
        scheduleRender(false);
      })();
      return;
    }
    scheduleRender(false);
  });

  if (isGameSyncActive()) {
    void (async () => {
      await refreshGameSession();
      scheduleRender(true);
    })();

    unsubSession = onGameSessionChange(async (row) => {
      if (!row) return;
      const resumeScreen = getResumableSessionScreen(row);
      if (shouldShowGameSelectResumeBanner(resumeScreen)) {
        scheduleRender(false);
        return;
      }
      if (await routeToActiveGameIfNeeded(row)) return;
      handleSessionRoute(row);
    });
  }

  return () => {
    // registerFilRougeRefresh(null);
    app.removeEventListener("click", onGameSelectClick);
    unsubResumeBanner();
    unsubSession();
    unsubLobby();
    if (renderTimer) clearTimeout(renderTimer);
  };
}
