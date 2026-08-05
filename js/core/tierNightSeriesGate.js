/**
 * FEATURE-TIERNIGHT-SERIES-04 — gate interne UI Série (désactivé par défaut).
 *
 * Tant que SERIES-06 n’a pas branché between/finalize, l’entrée UI réelle
 * reste fermée. Les tests peuvent activer le gate via globalThis.
 */

/** Clé explicite locale (pas de flag distant). */
export const TIER_NIGHT_SERIES_UI_GATE_KEY = "__REVEAL_TIERNIGHT_SERIES_UI__";

/**
 * @returns {boolean}
 */
export function isTierNightSeriesUiEnabled() {
  try {
    return globalThis?.[TIER_NIGHT_SERIES_UI_GATE_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Uniquement pour tests / smoke interne.
 * @param {boolean} enabled
 */
export function setTierNightSeriesUiEnabledForTests(enabled) {
  globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY] = Boolean(enabled);
}
