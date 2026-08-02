/**
 * UX-CHAT-01 — annonce chat quand l'hôte engage la préparation d'un jeu
 * (choix autoritaire catalogue / Recommencer → commitPrepSessionLaunch).
 *
 * Une seule annonce par entrée en prep. Pas d'annonce au clic « Lancer » (play).
 * Les invités en catch-up / Realtime ne doivent pas réémettre (émission hôte seule).
 *
 * Jeux sans écran prep dédié : aucun inventorié dans le catalogue actuel — tous
 * passent par un écran prep/menu/select avant launchGameWithSync.
 */
import { catalogTitleForSessionGameId } from "./gameCatalogTitle.js";

/**
 * @param {string} gameId
 * @returns {string}
 */
export function buildGamePreparationChatMessage(gameId) {
  const title = catalogTitleForSessionGameId(gameId);
  if (title) return `🎮 L'hôte lance la préparation de ${title}.`;
  return "🎮 L'hôte lance la préparation d'un jeu.";
}

/**
 * Best-effort : n'échoue jamais vers le caller de prep.
 * @param {string} gameId
 * @param {{ addMessage?: (text: string) => Promise<void>|void }} [opts]
 */
export async function announceGamePreparationInChat(gameId, opts = {}) {
  const title = catalogTitleForSessionGameId(gameId);
  if (!title) {
    console.warn("[UX-CHAT-01] catalog title unresolved", { gameId: gameId || null });
  }
  const text = buildGamePreparationChatMessage(gameId);
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

/** @deprecated nom v1 play — redirige vers la formulation préparation */
export function buildGameStartedChatMessage(gameId) {
  return buildGamePreparationChatMessage(gameId);
}

/** @deprecated */
export async function announceGameStartedInChat(gameId, opts = {}) {
  return announceGamePreparationInChat(gameId, opts);
}
