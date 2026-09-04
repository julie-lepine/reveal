import { navigate, goBack, getCurrentScreen } from "../core/router.js";
import {
  goToLobby,
  hasActiveLobby,
  confirmAndLeaveLobby,
  returnToEveningGames,
  tryRecoverLobbyFromServer,
} from "../core/lobby.js";
import { canPlay } from "../core/auth.js";
import {
  isGameSyncActive,
  isLobbyHost,
  isOnGameSetupScreen,
  isOnPostGameScreen,
  isSessionInProgressPlay,
  leaveGameSetup,
  returnToGameSelect,
  suppressSessionRoute,
  getCachedGameSession,
} from "../core/gameSync.js";
import { goToScores } from "../core/navAccess.js";
import { exitGameToGameSelect } from "../core/exitGame.js";

/** Accueil hors lobby ; en lobby actif le hub jeux remplace Accueil (UX-NAV-LOBBY). */
export async function goToEveningHome() {
  if (!hasActiveLobby()) {
    navigate("home", { reset: true });
    return;
  }
  await returnToEveningGames({ hubOnly: true });
}

/** Page Amis : même contrat que Menu (pas une manche). */
export function goToFriends() {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return;
  }
  if (getCurrentScreen() === "friends") return;
  if (hasActiveLobby()) {
    suppressSessionRoute(120000, getCachedGameSession()?.screen ?? null);
    navigate("friends");
    return;
  }
  navigate("friends");
}

export function goToEveningSettings({ tab } = {}) {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return;
  }
  const params = tab ? { tab } : null;
  if (getCurrentScreen() === "settings") {
    if (!params) return;
    navigate("settings", { params });
    return;
  }
  if (hasActiveLobby()) {
    suppressSessionRoute(120000, getCachedGameSession()?.screen ?? null);
    // Push sur la pile courante (game-select / results / leaderboard / …).
    if (params) navigate("settings", { params });
    else navigate("settings");
    return;
  }
  navigate("settings", {
    navStack: ["home", "settings"],
    ...(params ? { params } : {}),
  });
}

/** Retour au menu jeux (ou partie en cours) après profil / paramètres. */
export async function returnFromEveningProfile() {
  if (!hasActiveLobby()) {
    const recovered = await tryRecoverLobbyFromServer();
    if (recovered.ok) {
      await returnToEveningGames({ rejoinActiveGame: true });
      return;
    }
    goBack();
    return;
  }
  await returnToEveningGames({ rejoinActiveGame: true });
}

async function handleBackNavigation() {
  if (getCurrentScreen() === "settings" && !hasActiveLobby()) {
    navigate("home", { reset: true });
    return;
  }
  if (getCurrentScreen() === "lobby") {
    const res = await confirmAndLeaveLobby();
    if (res.cancelled) return;
    return;
  }
  if (getCurrentScreen() === "game-select") {
    // UX-NAV-LOBBY : Accueil n’est plus une destination depuis le hub jeux.
    return;
  }
  if (isGameSyncActive() && isOnGameSetupScreen(getCurrentScreen())) {
    if (isLobbyHost()) {
      const left = await leaveGameSetup();
      if (left) return;
    } else {
      if (await returnToGameSelect()) return;
    }
  }
  // UX-VIBE-02 / SYN-13b : ‹ en play = même flux que la barre d'exit (confirm).
  if (isSessionInProgressPlay(getCurrentScreen())) {
    await exitGameToGameSelect();
    return;
  }
  goBack();
}

export async function handleNavTarget(target, handlers) {
  if (target === "back") {
    await handleBackNavigation();
    return;
  }
  if (handlers[target]) {
    await handlers[target]();
    return;
  }
  // Accès centralisé aux scores : verrouillé en prépa / en jeu, libre ailleurs.
  // (Les flux de fin de partie passent par un handler custom ci-dessus, donc
  // ne sont pas concernés par ce verrou.)
  if (target === "results" || target === "leaderboard") {
    goToScores(target);
    return;
  }
  if (target === "home") {
    if (hasActiveLobby() && getCurrentScreen() === "lobby") {
      const res = await confirmAndLeaveLobby();
      if (res.cancelled) return;
      return;
    }
    if (hasActiveLobby()) {
      await goToEveningHome();
      return;
    }
    navigate("home", { reset: true });
    return;
  }
  if (target === "lobby") {
    goToLobby();
    return;
  }
  if (target === "game-select" && isGameSyncActive()) {
    const screen = getCurrentScreen();
    if (isSessionInProgressPlay(screen)) {
      await exitGameToGameSelect();
      return;
    }
    if (isOnGameSetupScreen(screen) || isOnPostGameScreen(screen)) {
      if (await returnToGameSelect()) return;
    }
  }
  if (target === "guesslie") {
    navigate("guesslie-menu");
    return;
  }
  if (target === "settings") {
    if (hasActiveLobby()) goToEveningSettings();
    else navigate("settings", { navStack: ["home", "settings"] });
    return;
  }
  if (target === "friends") {
    goToFriends();
    return;
  }
  navigate(target);
}

export function bindNav(root, handlers = {}) {
  root.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = el.getAttribute("data-nav");
      void handleNavTarget(target, handlers);
    });
  });
}
