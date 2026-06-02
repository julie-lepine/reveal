/** Identifiants app native (Capacitor) — alignés avec capacitor.config.ts. */
export const APP_BUNDLE_ID = "com.reveal.partygames";

/** Schéma URL pour deep links (auth Supabase, reset MDP). */
export const APP_URL_SCHEME = APP_BUNDLE_ID;

/** Redirect Supabase après reset MDP / OAuth (à ajouter dans le dashboard Supabase). */
export const NATIVE_AUTH_REDIRECT = `${APP_URL_SCHEME}://auth/callback`;

/**
 * URL publique de la politique de confidentialité (fiche store).
 * Déployer privacy.html sur GitHub Pages ou ton domaine.
 */
export const PRIVACY_POLICY_PUBLIC_URL =
  "https://revealthepartygame.fr/privacy.html";
