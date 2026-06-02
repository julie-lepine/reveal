import { isLoggedIn, isGuest } from "./auth.js";
import { hasActiveLobby } from "./lobby.js";
import { isPasswordRecoveryPending } from "./supabaseAuth.js";

const STORAGE_KEY = "reveal-welcome-seen";

export function markWelcomeSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* quota / private mode */
  }
}

export function hasSeenWelcome() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Afficher l’écran d’intro avant la page connexion (utilisateur non connecté). */
export function shouldShowWelcome() {
  if (isPasswordRecoveryPending()) return false;
  if (hasActiveLobby()) return false;
  if (isLoggedIn() || isGuest()) return false;
  if (sessionStorage.getItem("reveal-pending-join")) return false;
  if (hasSeenWelcome()) return false;
  return true;
}

export function resetWelcomeSeen() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
