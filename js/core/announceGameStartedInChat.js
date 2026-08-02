/**
 * UX-CHAT-01 — annonce chat quand une partie play démarre (via launchGameWithSync).
 *
 * v1.1 (non implémenté) : replays Trivia / Consensus qui appellent directement
 * `startGameSession(..., playScreen)` sans passer par launchGameWithSync —
 * réutiliser ce helper, ne pas inventer une 2e formulation ni une map de titres.
 */
import { catalogTitleForSessionGameId } from "./gameCatalogTitle.js";

/**
 * @param {string} gameId
 * @returns {string}
 */
export function buildGameStartedChatMessage(gameId) {
  const title = catalogTitleForSessionGameId(gameId);
  if (title) return `🎮 Une partie de ${title} commence !`;
  return "🎮 Une nouvelle partie commence !";
}

/**
 * Best-effort : n'échoue jamais vers le caller de lancement.
 * @param {string} gameId
 * @param {{ addMessage?: (text: string) => Promise<void>|void }} [opts]
 */
export async function announceGameStartedInChat(gameId, opts = {}) {
  const title = catalogTitleForSessionGameId(gameId);
  if (!title) {
    console.warn("[UX-CHAT-01] catalog title unresolved", { gameId: gameId || null });
  }
  const text = buildGameStartedChatMessage(gameId);
  try {
    const addMessage =
      typeof opts.addMessage === "function"
        ? opts.addMessage
        : (await import("./lobby.js")).addLobbyMessage;
    await addMessage(text);
  } catch (err) {
    console.warn("[UX-CHAT-01] announce failed", {
      gameId: gameId || null,
      message: err?.message || String(err),
    });
  }
}
