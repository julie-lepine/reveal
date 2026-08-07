/**
 * ARCH-01A — configuration backend absente ≠ mode démo / ≠ hors-ligne.
 *
 * Contrat :
 * - `isSupabaseConfigured() === false` → état terminal BACKEND_MISSING (runtime produit).
 * - `isSupabaseConfigured() === true` + `isGameSyncActive() === false` reste valide (pas de lobby).
 */

export const BACKEND_MISSING_SCREEN_ID = "backend-missing";

export const BACKEND_MISSING_TITLE = "Configuration requise";

export const BACKEND_MISSING_MESSAGE =
  "REVEAL ne peut pas se connecter au service multijoueur : la configuration backend est absente ou invalide sur ce build. Ce n’est pas une panne Internet — ajoute une configuration Supabase valide (voir la documentation de setup) puis relance l’application.";

/**
 * @param {{ isSupabaseConfigured: () => boolean }} deps
 */
export function shouldEnterBackendMissingGate(deps) {
  if (!deps || typeof deps.isSupabaseConfigured !== "function") {
    return false;
  }
  return deps.isSupabaseConfigured() !== true;
}

/**
 * Écrans autorisés lorsque le gate backend-missing est actif.
 * @param {string|null|undefined} screenId
 */
export function isBackendMissingAllowedScreen(screenId) {
  return screenId === BACKEND_MISSING_SCREEN_ID;
}
