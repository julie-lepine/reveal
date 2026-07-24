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
import { startLobbyPresenceSync, onLobbyBundleUpdated, getClaimHubUiToken } from "../core/supabaseLobby.js";
import { getLobby, hasActiveLobby, openPartySettings } from "../core/lobby.js";
import { clientMayOfferHostClaim } from "../core/hostClaimOffer.js";
import { getLastGame, getState } from "../core/state.js";
import { arch03LiveLog } from "../core/presenceUiLive.js";
// import { getFilRougeSession } from "../core/filRougeSession.js";
import { bindFeedbackPrompt, feedbackPromptCardHtml } from "../core/feedbackUi.js";
import {
  bindGameResumeBanner,
  gameResumeBannerHtml,
  getResumableSessionScreen,
  rejoinGameResumeTarget,
  shouldShowGameSelectResumeBanner,
  stayOnGameResumeTarget,
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

function lobbyPlayersMetaHtml(count) {
  const n = Number(count) || 0;
  const label = n <= 1 ? "joueur" : "joueurs";
  return `<p class="evening-recap__meta">${n} ${label} dans le lobby</p>`;
}

function eveningRecapHtml(recap) {
  const playersMeta = lobbyPlayersMetaHtml(recap.participantCount);

  if (!recap.hasActivity) {
    return `
      <div class="evening-recap evening-recap--empty card">
        <p class="evening-recap__title">📋 Récap de la soirée</p>
        <p class="evening-recap__empty">La soirée commence… lance un premier jeu !</p>
        ${playersMeta}
      </div>`;
  }

  const chips = [
    recap.hotTakes > 0
      ? `<span class="evening-recap__chip">🔥 ${recap.hotTakes} hot take${recap.hotTakes > 1 ? "s" : ""}</span>`
      : "",
    recap.guessLieGamesPlayed > 0
      ? `<span class="evening-recap__chip">🕵️ ${recap.guessLieGamesPlayed} Guess the Lie${recap.guessLieGamesPlayed > 1 ? "s" : ""}</span>`
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
      ${playersMeta}
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
    localIsHost: isLobbyHost(),
    mayClaim: clientMayOfferHostClaim(),
    claimHubTok: getClaimHubUiToken(),
    code: getLobby()?.code || "",
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

function gameSelectHeaderHtml() {
  const code = getLobby()?.code || "";
  const codeChip = code
    ? `<button type="button" class="game-select-code-chip" id="game-select-copy-code" data-code="${escapeHtml(code)}" aria-label="Copier le code ${escapeHtml(code)}">
        <span class="game-select-code-chip__code">${escapeHtml(code)}</span>
        <span class="game-select-code-chip__icon" aria-hidden="true">⧉</span>
      </button>`
    : "";

  return `
    <div class="game-select-header">
      <p class="label-upper label-upper--gold">🎮 La soirée</p>
      ${codeChip}
    </div>`;
}

function partySettingsButtonHtml() {
  // Admin : uniquement le vrai hôte (hostId). Pas de bouton trompeur pour les invités.
  if (!isGameSyncActive() || !isLobbyHost()) return "";
  return `
      <button type="button" class="game-select-party-settings" data-party-settings>
        ⚙️ Paramètres de partie
      </button>`;
}

/** CTA distinct ARCH-03b : offre claim sans réutiliser le libellé admin. */
function reclaimHostCtaHtml() {
  if (!isGameSyncActive() || isLobbyHost()) return "";
  if (!clientMayOfferHostClaim()) return "";
  return `
      <button type="button" class="game-select-reclaim-host" data-claim-host>
        👑 Reprendre l'animation
      </button>`;
}

function gameSelectActionsHtml() {
  return `
    <div class="game-select-actions">
      <button type="button" class="game-select-profile" data-nav="settings">Profil & paramètres</button>
      ${partySettingsButtonHtml()}
      ${reclaimHostCtaHtml()}
    </div>`;
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
  const catchupTimers = new Set();
  const navHandlers = buildGameSelectHandlers();

  function onGameSelectClick(e) {
    if (getCurrentScreen() !== "game-select") return;

    if (e.target.closest("#game-resume-banner-join")) {
      e.preventDefault();
      const btn = e.target.closest("#game-resume-banner-join");
      const resumeScreen =
        btn?.getAttribute("data-resume-screen") ||
        getResumableSessionScreen(getCachedGameSession());
      void rejoinGameResumeTarget(resumeScreen);
      return;
    }

    if (e.target.closest("#game-resume-banner-stay")) {
      e.preventDefault();
      stayOnGameResumeTarget();
      return;
    }

    const copyBtn = e.target.closest("#game-select-copy-code");
    if (copyBtn) {
      e.preventDefault();
      const code = copyBtn.getAttribute("data-code") || getLobby()?.code || "";
      const icon = copyBtn.querySelector(".game-select-code-chip__icon");
      void (async () => {
        try {
          await navigator.clipboard.writeText(code);
          if (icon) icon.textContent = "✓";
        } catch {
          if (icon) icon.textContent = "!";
        }
        setTimeout(() => {
          if (icon) icon.textContent = "⧉";
        }, 1200);
      })();
      return;
    }

    const restartEl = e.target.closest("[data-restart-game]");
    if (restartEl) {
      void restartGame(restartEl.getAttribute("data-restart-game"));
      return;
    }

    if (e.target.closest("[data-party-settings]")) {
      void openPartySettings().then((res) => {
        if (res.ok || res.claimed) scheduleRender(true);
      });
      return;
    }

    if (e.target.closest("[data-claim-host]")) {
      void (async () => {
        const { ensureLobbyHostOrOfferClaim } = await import("../core/hostClaimOffer.js");
        const access = await ensureLobbyHostOrOfferClaim({ reason: "reclaim-cta" });
        if (access.ok || access.claimed) scheduleRender(true);
      })();
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

  function scheduleSessionCatchup() {
    [0, 250, 800, 1500].forEach((delay) => {
      const timer = setTimeout(async () => {
        catchupTimers.delete(timer);
        if (getCurrentScreen() !== "game-select" || !isGameSyncActive()) return;
        const row = await refreshGameSession();
        if (row && (await routeToActiveGameIfNeeded(row))) return;
        scheduleRender(false);
      }, delay);
      catchupTimers.add(timer);
    });
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
      ${gameSelectHeaderHtml()}
      <h2 class="screen-title">Choisir un jeu</h2>
      <p class="game-intro">Sélectionne une activité pour le lobby.</p>
      ${gameSelectActionsHtml()}

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
    // Toujours re-évaluer le snapshot hub (mayClaim / claimHubTok) — le catchup
    // session seul ne suffit pas quand seul un bit de présence (hc/hp) bascule.
    const mayClaim = clientMayOfferHostClaim();
    arch03LiveLog("ARCH03B-LIVE", "hub UI nudge", {
      phase: "game-select-lobby-listener",
      mayClaim,
      claimHubTok: getClaimHubUiToken(),
      currentScreen: getCurrentScreen(),
    });
    scheduleRender(false);
    if (isGameSyncActive()) {
      scheduleSessionCatchup();
    }
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
    catchupTimers.forEach((timer) => clearTimeout(timer));
    catchupTimers.clear();
  };
}
