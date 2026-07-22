import { getCurrentScreen, navigate } from "./router.js";
import { isActiveGameSessionScreen, suppressRoutingForScoreView } from "./gameSync.js";
import { hasActiveLobby } from "./lobby.js";

/**
 * Politique centrale d'accès aux écrans de scores (Résultats / Classement).
 *
 * Règle unique, basée sur l'écran LOCAL du joueur (pas celui de l'hôte) :
 * verrouillé dès que le joueur est lui-même en préparation ou en partie,
 * libre partout ailleurs (accueil, menu jeux, lobby, résultats, classement, paramètres).
 *
 * `isActiveGameSessionScreen` renvoie déjà « tout sauf menu et post-partie »,
 * c.-à-d. les écrans `*-prep` et les écrans de jeu : exactement le périmètre voulu.
 */
export function isScoresNavLocked(screen = getCurrentScreen()) {
  return isActiveGameSessionScreen(screen);
}

const SCORES_NAV_STACK = {
  results: ["home", "lobby", "game-select", "results"],
  leaderboard: ["home", "lobby", "game-select", "leaderboard"],
};

/**
 * Navigation centralisée vers un écran de scores, respectant le verrou.
 * Tous les boutons « Résultats » / « Classement » de l'app passent par ici
 * (barre du bas + boutons in-screen via handleNavTarget).
 */
export function goToScores(target) {
  if (target !== "results" && target !== "leaderboard") return false;
  if (isScoresNavLocked()) return false;
  if (!hasActiveLobby()) {
    navigate("home", { reset: true });
    return false;
  }
  console.log("[SESSION-ROUTE]", {
    t: Date.now(),
    source: "goToScores",
    phase: "voluntary_scores_nav",
    target,
    from: getCurrentScreen(),
  });
  suppressRoutingForScoreView();
  navigate(target, { navStack: SCORES_NAV_STACK[target] });
  return true;
}
