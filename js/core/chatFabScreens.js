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
  "playlistguess-prep",
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

export function isChatFabAllowedScreen(screenId) {
  return CHAT_FAB_ALLOWED_SCREENS.has(screenId);
}
