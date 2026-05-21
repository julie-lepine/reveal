import { navigate, goBack, getCurrentScreen } from "../core/router.js";
import { goToLobby, hasActiveLobby, returnToEveningGames } from "../core/lobby.js";
import { canPlay } from "../core/auth.js";
import {
  isGameSyncActive,
  isLobbyHost,
  isOnGameSetupScreen,
  isOnPostGameScreen,
  leaveGameSetup,
  returnToGameSelect,
  suppressSessionRoute,
  getCachedGameSession,
} from "../core/gameSync.js";

/** Accueil sans quitter le lobby (soirée en cours). */
export function goToEveningHome() {
  if (!hasActiveLobby()) {
    navigate("home", { reset: true });
    return;
  }
  suppressSessionRoute(120000, getCachedGameSession()?.screen ?? null);
  navigate("home");
}

/** Paramètres sans quitter le lobby. */
export function goToEveningSettings() {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return;
  }
  if (hasActiveLobby()) {
    suppressSessionRoute(120000, getCachedGameSession()?.screen ?? null);
  }
  navigate("settings");
}

/** Retour au menu jeux (ou partie en cours) après profil / paramètres. */
export function returnFromEveningProfile() {
  if (!hasActiveLobby()) {
    goBack();
    return;
  }
  void returnToEveningGames();
}

async function handleBackNavigation() {
  if (isGameSyncActive() && isOnGameSetupScreen(getCurrentScreen())) {
    if (isLobbyHost()) {
      const left = await leaveGameSetup();
      if (left) return;
    } else {
      suppressSessionRoute();
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
      return;
    }
  }
  goBack();
}

async function handleNavTarget(target, handlers) {
  if (target === "back") {
    await handleBackNavigation();
    return;
  }
  if (handlers[target]) {
    await handlers[target]();
    return;
  }
  if (target === "home") {
    navigate("home", { reset: true });
    return;
  }
  if (target === "lobby") {
    goToLobby();
    return;
  }
  if (target === "game-select" && isGameSyncActive()) {
    const screen = getCurrentScreen();
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
    else navigate("settings");
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
