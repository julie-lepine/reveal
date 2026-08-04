/**
 * Dismiss local du bandeau reprise game-select (mémoire process uniquement).
 * Ne gère pas le suppress de routing (gameSync) - complémentaire UI.
 */

/** @type {string|null} */
let resumeBannerDismissedKey = null;

/**
 * Identité minimale de session pour le bandeau (pas le blob state, pas le label).
 * Prefer `game_id` row ; sinon famille d’écran dérivée des suffixes connus.
 */
export function resumeBannerSessionKey(screen, gameId = null) {
  const gid = gameId != null ? String(gameId).trim() : "";
  if (gid && gid !== "menu") return `game:${gid}`;
  if (!screen) return null;
  const family = String(screen)
    .replace(/-prep$/, "")
    .replace(/-select$/, "")
    .replace(/-create$/, "")
    .replace(/-live$/, "")
    .replace(/-menu$/, "")
    .replace(/-setup$/, "")
    .replace(/-wait$/, "")
    .replace(/-end$/, "");
  return family ? `family:${family}` : null;
}

/**
 * Machine de visibilité (pure).
 * @returns {{ show: boolean, dismissedKey: string|null }}
 */
export function evaluateResumeBannerVisibility({
  eligible,
  currentKey = null,
  dismissedKey = null,
} = {}) {
  if (!eligible) {
    return { show: false, dismissedKey: null };
  }
  if (dismissedKey == null) {
    return { show: true, dismissedKey: null };
  }
  // Nouvelle session (autre jeu / autre identité) alors que toujours éligible.
  if (currentKey && dismissedKey && currentKey !== dismissedKey) {
    return { show: true, dismissedKey: null };
  }
  return { show: false, dismissedKey };
}

export function getResumeBannerDismissedKey() {
  return resumeBannerDismissedKey;
}

export function clearResumeBannerDismiss() {
  resumeBannerDismissedKey = null;
}

/** Marque le bandeau dismissé pour la session courante. */
export function dismissResumeBannerForSession(screen, gameId = null) {
  resumeBannerDismissedKey = resumeBannerSessionKey(screen, gameId);
}

/**
 * Applique éligibilité + dismiss ; met à jour la mémoire (clear si non éligible / nouvelle clé).
 */
export function shouldShowResumeBannerAfterDismiss({
  eligible,
  screen = null,
  gameId = null,
} = {}) {
  const currentKey = resumeBannerSessionKey(screen, gameId);
  const result = evaluateResumeBannerVisibility({
    eligible,
    currentKey,
    dismissedKey: resumeBannerDismissedKey,
  });
  resumeBannerDismissedKey = result.dismissedKey;
  return result.show;
}

/** @internal tests */
export function __resetResumeBannerDismissForTests() {
  resumeBannerDismissedKey = null;
}
