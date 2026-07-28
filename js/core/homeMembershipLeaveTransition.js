/**
 * Vague E3 — marqueur UI process-level post-leave (pas une SoT membership).
 *
 * Après DELETE/dissolve confirmé, le snapshot est null jusqu’à la query.
 * Ce marqueur empêche le chrome générique `checking` pendant cette fenêtre.
 * Mémoire process uniquement — pas de localStorage / sessionStorage.
 */

let active = false;
let generation = 0;
/** Compteurs tests — une mutation volontaire réussie ⇒ 1 begin + 1 end correspondant. */
let beginCallCount = 0;
let endCallCount = 0;

/** @returns {number} génération de la transition démarrée */
export function beginPostLeaveHomeTransition() {
  beginCallCount += 1;
  generation += 1;
  active = true;
  return generation;
}

export function isPostLeaveHomeTransitionActive() {
  return active;
}

export function getPostLeaveHomeTransitionGeneration() {
  return generation;
}

/**
 * Termine la transition si `expectedGeneration` est omise ou égale à la courante.
 * @param {number|null|undefined} [expectedGeneration]
 * @returns {boolean} true si désactivée
 */
export function endPostLeaveHomeTransition(expectedGeneration = null) {
  if (!active) return false;
  if (
    expectedGeneration != null &&
    Number(expectedGeneration) !== generation
  ) {
    return false;
  }
  active = false;
  endCallCount += 1;
  return true;
}

/** Tests uniquement. */
export function __resetPostLeaveHomeTransitionForTests() {
  active = false;
  generation = 0;
  beginCallCount = 0;
  endCallCount = 0;
}

/** Tests uniquement. */
export function __getPostLeaveTransitionCallCountsForTests() {
  return { begin: beginCallCount, end: endCallCount, generation };
}
