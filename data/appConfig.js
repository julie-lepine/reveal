/** Identifiants app native (Capacitor) - alignés avec capacitor.config.ts. */
export const APP_BUNDLE_ID = "com.reveal.partygames";

/** Schéma URL pour deep links (auth Supabase, reset MDP). */
export const APP_URL_SCHEME = APP_BUNDLE_ID;

/** Redirect Supabase après reset MDP / OAuth (à ajouter dans le dashboard Supabase). */
export const NATIVE_AUTH_REDIRECT = `${APP_URL_SCHEME}://auth/callback`;

/**
 * Page Turnstile iOS (WebView in-app). Domaine store, pas GitHub Pages.
 * À autoriser dans Cloudflare Turnstile → Hostnames : `revealthepartygame.fr`.
 */
export const NATIVE_CAPTCHA_PAGE_URL =
  "https://revealthepartygame.fr/captcha.html";

/** Retour app après le défi natif (`sid` seulement — le token passe par Realtime). */
export const NATIVE_CAPTCHA_REDIRECT = `${APP_URL_SCHEME}://captcha`;

/**
 * URL publique de la politique de confidentialité (fiche store).
 * Déployer privacy.html sur GitHub Pages ou ton domaine.
 */
export const PRIVACY_POLICY_PUBLIC_URL =
  "https://revealthepartygame.fr/privacy.html";

/** Contact officiel (RGPD, store, mentions légales). */
export const CONTACT_EMAIL = "contact@revealthepartygame.fr";

/**
 * URL publique - demande de suppression de compte (Play Console / App Store).
 * Déployer suppression-compte.html sur le même domaine que privacy.html.
 */
export const ACCOUNT_DELETION_PUBLIC_URL =
  "https://revealthepartygame.fr/suppression-compte.html";

/** Lien mailto prérempli pour la demande de suppression (page web + app). */
export const ACCOUNT_DELETION_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Demande de suppression de compte REVEAL")}`;

/** Profil Instagram (retours informels, communauté). */
export const INSTAGRAM_PROFILE_URL =
  "https://www.instagram.com/revealthepartygame/";

export const INSTAGRAM_HANDLE = "revealthepartygame";
