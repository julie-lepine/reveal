/**
 * Décision pure du filet post-partie (voir ensurePostGameScreen dans gameSync.js).
 *
 * Après `completeGameSession`, l'hôte doit avoir quitté l'écran du jeu. S'il y est
 * encore, on le renvoie vers l'écran post-partie. S'il a déjà navigué ailleurs
 * (résultats atteints, Menu ouvert…), on ne fait rien.
 *
 * @param {string} target écran post-partie visé (ex. "results")
 * @param {{ from?: string|null, current?: string|null, postGameScreens: Set<string> }} ctx
 * @returns {string|null} écran vers lequel naviguer, ou null
 */
export function postGameFallbackTarget(target, { from = null, current = null, postGameScreens } = {}) {
  if (!target || !postGameScreens?.has(target)) return null;
  if (!from || current !== from) return null;
  if (current === target) return null;
  return target;
}
