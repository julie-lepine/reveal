/** Écrans Vague A : FAB chat hors gameplay actif (aucune détection de phase). */
export const CHAT_FAB_ALLOWED_SCREENS = new Set([
  "game-select",
  "results",
  "leaderboard",
  "traitre-prep",
  "hottake-prep",
  "speedvote-prep",
  "clutch-prep",
  "wronganswer-prep",
  "truthmeter-prep",
  "dilemma-prep",
  "trivia-prep",
  "consensus-prep",
  "guesslie-setup",
  "guesslie-menu",
  "guesslie-wait",
  "tiernight-select",
  "tiernight-create",
  "tiernight-end",
]);

/**
 * Hub entre jeux : le sheet chat peut rester ouvert d'un écran à l'autre.
 * Les prépas / setups restent FAB-autorisés mais ferment le sheet à l'entrée
 * (lancement roulette ou classique → game-prep sans overlay résiduel).
 */
export const CHAT_HUB_SCREENS = new Set([
  "game-select",
  "results",
  "leaderboard",
]);

export function isChatFabAllowedScreen(screenId) {
  return CHAT_FAB_ALLOWED_SCREENS.has(screenId);
}

export function isChatHubScreen(screenId) {
  return CHAT_HUB_SCREENS.has(screenId);
}

/**
 * True si l'entrée sur cet écran doit fermer un sheet chat éventuellement ouvert.
 * - hors whitelist FAB → déjà couvert (FAB masqué)
 * - prépa / setup FAB-autorisé → fermer le sheet, FAB reste dispo pour réouvrir
 */
export function shouldAutoCloseChatSheetOnScreen(screenId) {
  if (!screenId) return false;
  if (!isChatFabAllowedScreen(screenId)) return true;
  return !isChatHubScreen(screenId);
}
