/** Écrans Vague A : FAB chat hors gameplay actif (aucune détection de phase). */
export const CHAT_FAB_ALLOWED_SCREENS = new Set([
  "game-select",
  "results",
  "leaderboard",
  "traitre-prep",
  "hottake-prep",
  "speedvote-prep",
  "clutch-prep",
  "drawit-prep",
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
 * - prépa / setup FAB-autorisé → fermer le sheet à la *transition*, FAB reste dispo
 *
 * Important : ce prédicat décrit l'écran cible. L'appelant doit le combiner avec
 * une détection de *changement* d'écran (edge), pas le ré-appliquer en boucle
 * tant que l'utilisateur reste sur cet écran (réouverture manuelle du chat en prépa).
 */
export function shouldAutoCloseChatSheetOnScreen(screenId) {
  if (!screenId) return false;
  if (!isChatFabAllowedScreen(screenId)) return true;
  return !isChatHubScreen(screenId);
}

/**
 * Transition qui doit déclencher la fermeture du sheet (une fois).
 * @param {string|null|undefined} prevScreen
 * @param {string|null|undefined} nextScreen
 */
export function shouldDismissChatSheetOnScreenTransition(prevScreen, nextScreen) {
  if (!nextScreen) return false;
  if (!shouldAutoCloseChatSheetOnScreen(nextScreen)) return false;
  // Première observation déjà hors hub (reconnect prep) → fermer résidus.
  if (prevScreen == null || prevScreen === "") return true;
  if (prevScreen === nextScreen) return false;
  // Déjà hors hub auparavant (prep → autre prep) : pas de re-close forcé.
  if (shouldAutoCloseChatSheetOnScreen(prevScreen)) return false;
  return true;
}
