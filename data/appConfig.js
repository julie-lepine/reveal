/** Identifiants app native (Capacitor) - alignés avec capacitor.config.ts. */
export const APP_BUNDLE_ID = "com.reveal.partygames";

/** Schéma URL pour deep links (auth Supabase, reset MDP). */
export const APP_URL_SCHEME = APP_BUNDLE_ID;

/** Redirect Supabase après reset MDP / OAuth (à ajouter dans le dashboard Supabase). */
export const NATIVE_AUTH_REDIRECT = `${APP_URL_SCHEME}://auth/callback`;

/**
 * URL publique de la politique de confidentialité (fiches store).
 * Canonique : havefuncorp.fr/reveal/privacy (les .html redirigent en 301).
 */
export const PRIVACY_POLICY_PUBLIC_URL =
  "https://havefuncorp.fr/reveal/privacy";

/** Contact officiel (RGPD, store, mentions légales). */
export const CONTACT_EMAIL = "contact@revealthepartygame.fr";

/**
 * URL publique — demande de suppression de compte (Play Console / App Store).
 * Même site que PRIVACY_POLICY_PUBLIC_URL.
 */
export const ACCOUNT_DELETION_PUBLIC_URL =
  "https://havefuncorp.fr/reveal/suppression-compte";

/** Lien mailto prérempli pour la demande de suppression (page web + app). */
export const ACCOUNT_DELETION_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Demande de suppression de compte REVEAL")}`;

/** Profil Instagram (retours informels, communauté). */
export const INSTAGRAM_PROFILE_URL =
  "https://www.instagram.com/revealthepartygame/";

export const INSTAGRAM_HANDLE = "revealthepartygame";
