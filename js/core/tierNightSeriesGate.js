/**
 * FEATURE-TIERNIGHT-03-F - parcours série = produit final « Classe le groupe ».
 *
 * Clé : `__REVEAL_TIERNIGHT_SERIES_UI__` (`TIER_NIGHT_SERIES_UI_GATE_KEY`)
 * Lu via : `isTierNightSeriesUiEnabled()` (local only - pas de flag distant).
 *
 * ## Comportement final (F)
 * - **Défaut ON** : clé absente ou `true` → parcours série canonique.
 * - **Kill switch** : `=== false` uniquement → bloque une *nouvelle* entrée série
 *   (message sûr / reste sur modes). **Ne réactive jamais** la création classic.
 * - Sessions série / classic déjà actives : l’état partagé gagne (hors gate).
 * - Rank Live : inchangé.
 *
 * ## Ne plus utiliser
 * - Gate OFF comme rollback grille mono-thème / `markTierNightClassicStarted`.
 */

/** Clé explicite locale (pas de flag distant). */
export const TIER_NIGHT_SERIES_UI_GATE_KEY = "__REVEAL_TIERNIGHT_SERIES_UI__";

/**
 * Parcours série produit actif ?
 * @returns {boolean} true sauf kill switch explicite `false`
 */
export function isTierNightSeriesUiEnabled() {
  try {
    if (globalThis?.[TIER_NIGHT_SERIES_UI_GATE_KEY] === false) return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Tests / smoke : `true` = série ON ; `false` = kill switch (jamais classic).
 * @param {boolean} enabled
 */
export function setTierNightSeriesUiEnabledForTests(enabled) {
  globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY] = Boolean(enabled);
}
