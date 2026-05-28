import { showAppConfirm } from "./dialog.js";
import { escapeHtml } from "./ui.js";
import {
  isGameSyncActive,
  isLobbyHost,
  returnToGameSelect,
  suppressSessionRoute,
} from "./gameSync.js";
import { navigate } from "./router.js";
import { resetGameSessionsOnly } from "./state.js";
import { goToGameSelect, setLobbyWaiting } from "./lobby.js";

export const EXIT_GAME_LABEL = "Arrêter la partie - menu des jeux";

export function gameExitBarHtml() {
  const label =
    isGameSyncActive() && !isLobbyHost()
      ? "Quitter la partie - menu des jeux"
      : EXIT_GAME_LABEL;
  return `<div class="game-exit-bar">
    <button type="button" class="btn btn-secondary btn--compact game-exit-bar__btn" data-exit-game>${escapeHtml(label)}</button>
  </div>`;
}

/** @deprecated Utiliser gameExitBarHtml */
export const exitGameToLobbyButtonHtml = gameExitBarHtml;

/** Quitte la partie en cours → menu des jeux (hôte : termine la session pour tous). */
export async function exitGameToGameSelect() {
  const mp = isGameSyncActive();
  const host = mp && isLobbyHost();
  const ok = await showAppConfirm(
    host
      ? "Arrêter la partie pour tout le monde et revenir au menu des jeux ?"
      : "Tu quittes cette partie et retournes au menu des jeux. Les autres joueurs continuent tant que l'hôte n'arrête pas la partie.",
    {
      title: host ? "Arrêter la partie" : "Quitter la partie",
      confirmLabel: "Menu des jeux",
      icon: "🛑",
    }
  );
  if (!ok) return false;

  if (mp) {
    if (host) {
      await returnToGameSelect();
    } else {
      suppressSessionRoute(120000);
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
    }
    return true;
  }

  resetGameSessionsOnly();
  await setLobbyWaiting();
  await goToGameSelect();
  return true;
}

/** @deprecated Utiliser exitGameToGameSelect */
export const exitGameToLobby = exitGameToGameSelect;

export function bindExitGame(root) {
  root.querySelector("[data-exit-game]")?.addEventListener("click", () => {
    void exitGameToGameSelect();
  });
}

/** @deprecated Utiliser bindExitGame */
export const bindExitGameToLobby = bindExitGame;
