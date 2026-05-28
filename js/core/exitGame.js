import { showAppConfirm } from "./dialog.js";
import { escapeHtml } from "./ui.js";
import { isGameSyncActive, isLobbyHost, returnToGameSelect } from "./gameSync.js";
import { resetGameSessionsOnly } from "./state.js";
import { goToGameSelect, setLobbyWaiting } from "./lobby.js";

export const EXIT_GAME_LABEL = "Arrêter la partie - menu des jeux";

export function gameExitBarHtml() {
  return `<div class="game-exit-bar">
    <button type="button" class="btn btn-secondary btn--compact game-exit-bar__btn" data-exit-game>${escapeHtml(EXIT_GAME_LABEL)}</button>
  </div>`;
}

/** @deprecated Utiliser gameExitBarHtml */
export const exitGameToLobbyButtonHtml = gameExitBarHtml;

/** Quitte la partie en cours → menu des jeux (hôte : termine la session pour tous). */
export async function exitGameToGameSelect() {
  const host = isGameSyncActive() && isLobbyHost();
  const ok = await showAppConfirm(
    host
      ? "Arrêter la partie pour tout le monde et revenir au menu des jeux ?"
      : "Quitter cette partie et revenir au menu des jeux ?",
    {
      title: "Arrêter la partie",
      confirmLabel: "Menu des jeux",
      icon: "🛑",
    }
  );
  if (!ok) return false;

  if (isGameSyncActive()) {
    await returnToGameSelect();
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
