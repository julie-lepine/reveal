/**
 * ARCH-23 — identité commerciale / compatibilité client-serveur.
 * APP_COMPATIBILITY_BUILD est le seul entier comparable au floor Supabase.
 * Les versionCode / CFBundleVersion natifs restent diagnostiques (pas le gate).
 *
 * Heuristiques Vague 1 (centralisées ici uniquement) :
 * - CLIENT_COMPAT_FRESH_MS = 5 min — cache d’un résultat `compatible`
 * - CLIENT_COMPAT_TIMEOUT_MS = 8 s — plafond RPC
 * - CLIENT_COMPAT_FOREGROUND_MIN_HIDDEN_MS = 10 min — recheck force au foreground
 *
 * Périmètre Vague 1 (gates) : boot · create · join · resume · foreground.
 * Hors périmètre : chaque write in-game (votes / commits / phases) pendant une
 * partie déjà active — si le floor est relevé mid-soirée, un ancien client peut
 * encore envoyer des writes jusqu’au prochain gate. Conséquence ops : ne pas
 * bumper un floor cassant pendant des soirées engagées ; rétrocompat backend
 * temporaire recommandée. Guard global des writes = ticket ultérieur.
 */

/** Version commerciale affichée (alignée release courante Android ; iOS peut différer). */
export const APP_VERSION = "1.0.3";

/**
 * Niveau de contrat client/serveur — commun iOS, Android et web pour un même code.
 * Augmenter uniquement quand une évolution serveur rend les anciens binaires incompatibles.
 * Vague 1 : rester à 1 (égal au floor SQL initial) — ne pas bloquer la prod.
 */
export const APP_COMPATIBILITY_BUILD = 1;

/**
 * URLs stores — laisser vide tant que non publiées / non confirmées.
 * Le bouton « Mettre à jour » n’apparaît que si l’URL de la plateforme est non vide.
 */
export const IOS_APP_STORE_URL = "";
export const ANDROID_PLAY_STORE_URL = "";

/** Timeout contrôle serveur (ms). Heuristique Vague 1. */
export const CLIENT_COMPAT_TIMEOUT_MS = 8_000;

/** Fraîcheur d’un résultat `compatible` réutilisable (ms). Heuristique Vague 1. */
export const CLIENT_COMPAT_FRESH_MS = 5 * 60_000;

/** Revalidation foreground si suspension ≥ cette durée (ms). Heuristique Vague 1. */
export const CLIENT_COMPAT_FOREGROUND_MIN_HIDDEN_MS = 10 * 60_000;

/** Codes d’erreur internes ARCH-23 (create / join / assert). */
export const CLIENT_COMPAT_ERROR = Object.freeze({
  INCOMPATIBLE: "CLIENT_INCOMPATIBLE",
  UNKNOWN: "CLIENT_COMPAT_UNKNOWN",
  CHECK_FAILED: "CLIENT_COMPAT_CHECK_FAILED",
});
