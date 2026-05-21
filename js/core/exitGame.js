import { showAppConfirm } from "./dialog.js";
import { escapeHtml } from "./ui.js";
import {
  isGameSyncActive,
  isLobbyHost,
  endGameSession,
  suppressSessionRoute,
} from "./gameSync.js";
import { resetEveningState } from "./state.js";
import { goToLobby } from "./lobby.js";

export const EXIT_GAME_LOBBY_LABEL = "Sortir du jeu — retour au lobby";

export function exitGameToLobbyButtonHtml() {
  return `<button type="button" class="btn-link game-exit-lobby btn--spaced" data-exit-game-lobby>${escapeHtml(EXIT_GAME_LOBBY_LABEL)}</button>`;
}

/** Quitte la partie en cours et renvoie au lobby (hôte : termine la session pour tous). */
export async function exitGameToLobby() {
  const host = isGameSyncActive() && isLobbyHost();
  const ok = await showAppConfirm(
    host
      ? "Terminer la partie pour tout le monde et retourner au lobby ?"
      : "Quitter la partie en cours et retourner au lobby ? Les autres joueurs peuvent continuer sans toi.",
    {
      title: "Sortir du jeu",
      confirmLabel: "Retour au lobby",
      icon: "🚪",
    }
  );
  if (!ok) return false;

  if (isGameSyncActive()) {
    if (host) {
      await endGameSession();
      resetEveningState();
    } else {
      suppressSessionRoute(120000);
    }
  }
  goToLobby();
  return true;
}

export function bindExitGameToLobby(root) {
  root.querySelector("[data-exit-game-lobby]")?.addEventListener("click", () => {
    void exitGameToLobby();
  });
}
