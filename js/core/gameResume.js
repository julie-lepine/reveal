import { escapeHtml, pageShell } from "./ui.js";
import {
  clearSessionRouteSuppress,
  applyRemoteSession,
  getCachedGameSession,
  getResumableSessionScreen,
  isGameSyncActive,
  isLobbyHost,
  isOnGameSetupScreen,
  isResumableSessionDestination,
  refreshGameSession,
  isSessionInProgressPlay,
  routeToActiveGameIfNeeded,
  routeToSessionScreen,
  suppressRoutingForScoreView,
} from "./gameSync.js";
import {
  clearResumeBannerDismiss,
  dismissResumeBannerForSession,
  shouldShowResumeBannerAfterDismiss,
} from "./resumeBannerDismiss.js";
import { bindNav } from "../screens/nav.js";

const SCREEN_LABELS = {
  "traitre-prep": "Spot the fake",
  traitre: "Spot the fake",
  "playlistguess-prep": "VibeCheck",
  playlistguess: "VibeCheck",
  "consensus-prep": "Consensus",
  consensus: "Consensus",
  "hottake-prep": "Hot Take",
  hottake: "Hot Take",
  "guesslie-menu": "Guess The Lie",
  "guesslie-setup": "Guess The Lie",
  "guesslie-wait": "Guess The Lie",
  guesslie: "Guess The Lie",
  "speedvote-prep": "SpeedVote",
  speedvote: "SpeedVote",
  "dilemma-prep": "Dilemma",
  dilemma: "Dilemma",
  "truthmeter-prep": "TruthMeter",
  truthmeter: "TruthMeter",
  "tiernight-select": "TierNight",
  "tiernight-create": "TierNight",
  tiernight: "TierNight",
  "tiernight-live": "TierNight",
  "trivia-prep": "Trivia Quiz",
  trivia: "Trivia Quiz",
  "wronganswer-prep": "Wrong Answer Only",
  wronganswer: "Wrong Answer Only",
};

export function gameLabelForScreen(screen) {
  if (!screen) return "Jeu";
  return SCREEN_LABELS[screen] || screen;
}

function resumeSubtitle(screen) {
  if (isOnGameSetupScreen(screen)) {
    return "Préparation en cours - tu seras renvoyé dans la partie sous peu.";
  }
  return "Partie en cours - tu seras renvoyé dans la partie sous peu.";
}

export function gameResumeInterstitialHtml({
  gameLabel,
  subtitle,
  countdownSec,
  allowStay = false,
}) {
  const countdown =
    countdownSec != null
      ? `<p class="hint game-resume__countdown">Retour automatique dans ${countdownSec} s...</p>`
      : "";
  return `
    <div class="game-resume card card--hot">
      <p class="label-upper label-upper--gold">🎮 Jeu en cours</p>
      <h2 class="screen-title">${escapeHtml(gameLabel)}</h2>
      <p class="hint">${escapeHtml(subtitle)}</p>
      ${countdown}
      <button type="button" class="btn btn-primary btn--spaced" id="game-resume-now">Rejoindre maintenant</button>
      ${
        allowStay
          ? `<button type="button" class="btn btn-secondary btn--spaced" id="game-resume-stay">Rester ici</button>`
          : ""
      }
    </div>`;
}

/**
 * Destination de bandeau : délègue à isResumableSessionDestination (gameSync).
 * Appeler avec le résultat de getResumableSessionScreen.
 */
export function isGameSelectResumeBannerScreen(screen) {
  return isResumableSessionDestination(screen);
}

function resumeBannerHint(screen) {
  if (isOnGameSetupScreen(screen)) {
    return "Tu peux rejoindre la préparation ou rester sur le menu des jeux.";
  }
  return "Tu peux rejoindre la partie ou rester sur le menu des jeux.";
}

function resumeBannerTitle(screen) {
  const label = gameLabelForScreen(screen);
  if (isOnGameSetupScreen(screen)) {
    return `🎮 ${label} — préparation`;
  }
  return `🎮 ${label} en cours`;
}

export function gameResumeBannerHtml(screen) {
  if (!isGameSelectResumeBannerScreen(screen)) return "";
  const escapedScreen = escapeHtml(screen);
  return `
    <div class="game-resume-banner card" role="status">
      <p class="game-resume-banner__title">${escapeHtml(resumeBannerTitle(screen))}</p>
      <p class="hint">${escapeHtml(resumeBannerHint(screen))}</p>
      <div class="game-resume-banner__actions">
        <button type="button" class="btn btn-primary btn--compact" id="game-resume-banner-join" data-resume-screen="${escapedScreen}">Rejoindre</button>
        <button type="button" class="btn btn-secondary btn--compact" id="game-resume-banner-stay" data-resume-screen="${escapedScreen}">Rester ici</button>
      </div>
    </div>`;
}

export async function rejoinGameResumeTarget(targetScreen) {
  clearResumeBannerDismiss();
  clearSessionRouteSuppress();
  if (!targetScreen) return false;
  const cached = getCachedGameSession();
  if (cached?.state) applyRemoteSession(cached);
  routeToSessionScreen(targetScreen, { force: true });
  void refreshGameSession().then((row) => {
    if (row) void routeToActiveGameIfNeeded(row, { force: true });
  });
  return true;
}

/**
 * Rester sur le hub : suppress auto-route (inchangé) + dismiss UI bandeau.
 * @param {string|null} [resumeScreen] écran reprenable courant (sinon dérivé du cache)
 */
export function stayOnGameResumeTarget(resumeScreen = null) {
  suppressRoutingForScoreView();
  const row = getCachedGameSession();
  const screen =
    resumeScreen || getResumableSessionScreen(row) || row?.screen || null;
  dismissResumeBannerForSession(screen, row?.game_id ?? null);
}

/**
 * Ecran plein page (lobby par erreur) : reprise auto vers prep / partie.
 * @returns {() => void} cleanup
 * NOTE (résidu) : « Rester ici » de l’interstitial (#game-resume-stay) ne masque
 * pas l’UI plein écran — hors scope du fix bandeau game-select.
 */
export function mountGameResumeInterstitial(app, targetScreen, { allowStay = false } = {}) {
  const gameLabel = gameLabelForScreen(targetScreen);
  const subtitle = resumeSubtitle(targetScreen);
  const autoRedirectMs = 2500;
  let remaining = Math.ceil(autoRedirectMs / 1000);
  let disposed = false;
  let tickId = null;
  let redirectTimer = null;

  const cleanup = () => {
    disposed = true;
    if (tickId) clearInterval(tickId);
    if (redirectTimer) clearTimeout(redirectTimer);
  };

  const rejoin = async () => {
    if (disposed) return;
    cleanup();
    if (!isGameSyncActive()) return;
    await rejoinGameResumeTarget(targetScreen);
  };

  const paint = () => {
    app.innerHTML = pageShell({
      backTarget: "back",
      content: gameResumeInterstitialHtml({
        gameLabel,
        subtitle,
        countdownSec: remaining,
        allowStay,
      }),
    });
    bindNav(app);
    app.querySelector("#game-resume-now")?.addEventListener("click", () => {
      void rejoin();
    });
    app.querySelector("#game-resume-stay")?.addEventListener("click", () => {
      cleanup();
      if (isSessionInProgressPlay(targetScreen)) stayOnGameResumeTarget();
    });
  };

  paint();
  tickId = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      if (tickId) {
        clearInterval(tickId);
        tickId = null;
      }
      return;
    }
    const el = app.querySelector(".game-resume__countdown");
    if (el) el.textContent = `Retour automatique dans ${remaining} s...`;
  }, 1000);

  redirectTimer = setTimeout(() => {
    void rejoin();
  }, autoRedirectMs);

  return cleanup;
}

/** Bandeau menu jeux (invité, prep ou partie reprenable). */
export function bindGameResumeBanner(app, targetScreen) {
  if (!isGameSelectResumeBannerScreen(targetScreen)) return () => {};

  const rejoin = async () => {
    await rejoinGameResumeTarget(targetScreen);
  };

  const onJoin = () => void rejoin();
  const onStay = () => stayOnGameResumeTarget(targetScreen);

  app.querySelector("#game-resume-banner-join")?.addEventListener("click", onJoin);
  app.querySelector("#game-resume-banner-stay")?.addEventListener("click", onStay);

  return () => {
    app.querySelector("#game-resume-banner-join")?.removeEventListener("click", onJoin);
    app.querySelector("#game-resume-banner-stay")?.removeEventListener("click", onStay);
  };
}

export function shouldShowGameSelectResumeBanner(screen, opts = {}) {
  const syncActive = opts.syncActive ?? isGameSyncActive();
  const isHost = opts.isHost ?? isLobbyHost();
  const gameId =
    opts.gameId !== undefined
      ? opts.gameId
      : getCachedGameSession()?.game_id ?? null;
  const eligible =
    Boolean(screen) &&
    isGameSelectResumeBannerScreen(screen) &&
    syncActive &&
    !isHost;
  return shouldShowResumeBannerAfterDismiss({
    eligible,
    screen,
    gameId,
  });
}

export { getResumableSessionScreen };
export {
  clearResumeBannerDismiss,
  dismissResumeBannerForSession,
  resumeBannerSessionKey,
  evaluateResumeBannerVisibility,
  getResumeBannerDismissedKey,
} from "./resumeBannerDismiss.js";
