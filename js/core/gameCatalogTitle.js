/**
 * Titres catalogue : game_id session → tile id → GAMES[].title
 * Source unique pour restart, sync lastGame, annonces chat (UX-CHAT-01).
 */
import { GAMES } from "../../data/games.js";

/** Mapping structurel (ids), pas une table de libellés. */
export const SESSION_GAME_ID_TO_TILE = {
  traitre: "traitre-prep",
  hottake: "hottake-prep",
  speedvote: "speedvote-prep",
  trivia: "trivia-prep",
  truthmeter: "truthmeter-prep",
  consensus: "consensus-prep",
  dilemma: "dilemma-prep",
  guesslie: "guesslie",
  tiernight: "tiernight-select",
  clutch: "clutch-prep",
  drawit: "drawit-prep",
  wronganswer: "wronganswer-prep",
};

/** Inverse catalogue tile → game_id session (FEATURE-CHAT-03 / launchCatalogGame). */
export const TILE_ID_TO_SESSION_GAME_ID = Object.fromEntries(
  Object.entries(SESSION_GAME_ID_TO_TILE).map(([sessionId, tileId]) => [
    tileId,
    sessionId,
  ])
);

function catalogForSessionGameId(gameId) {
  if (!gameId || typeof gameId !== "string") return null;
  const tileId = SESSION_GAME_ID_TO_TILE[gameId];
  if (!tileId) return null;
  return GAMES.find((g) => g.id === tileId) || null;
}

/**
 * @param {string|null|undefined} gameId
 * @returns {string|null} titre officiel catalogue, ou null si inconnu
 */
export function catalogTitleForSessionGameId(gameId) {
  return catalogForSessionGameId(gameId)?.title || null;
}

/** Emoji catalogue (tuile jeu), ou null si inconnu. */
export function catalogEmojiForSessionGameId(gameId) {
  return catalogForSessionGameId(gameId)?.emoji || null;
}
