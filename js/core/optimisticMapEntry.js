/**
 * SYN-VOTE-ROLLBACK-01 - apply / rollback ciblé d'une entrée de map optimiste.
 * Pur / testable. Ne restaure jamais une map entière.
 */

/**
 * @param {{ map?: Record<string, unknown>|null, key: string, value: unknown }} input
 * @returns {{
 *   hadPreviousValue: boolean,
 *   previousValue: unknown,
 *   optimisticValue: unknown,
 *   nextMap: Record<string, unknown>,
 * }}
 */
export function computeOptimisticMapEntryApply({ map, key, value }) {
  const source =
    map && typeof map === "object" && !Array.isArray(map) ? { ...map } : {};
  const hadPreviousValue = Object.prototype.hasOwnProperty.call(source, key);
  const previousValue = hadPreviousValue ? source[key] : undefined;
  const nextMap = { ...source, [key]: value };
  return {
    hadPreviousValue,
    previousValue,
    optimisticValue: value,
    nextMap,
  };
}

/**
 * Rollback conditionnel : n'agit que si l'entrée courante est encore celle de la tentative.
 * Clé absente avant → delete réel (pas `undefined`).
 *
 * @param {{
 *   currentMap?: Record<string, unknown>|null,
 *   key: string,
 *   hadPreviousValue: boolean,
 *   previousValue?: unknown,
 *   optimisticValue: unknown,
 *   attemptId?: number|string|null,
 *   currentAttemptId?: number|string|null,
 *   valuesEqual?: (a: unknown, b: unknown) => boolean,
 * }} input
 * @returns {{
 *   map: Record<string, unknown>,
 *   applied: boolean,
 *   reason?: string,
 * }}
 */
export function rollbackOptimisticMapEntry(input = {}) {
  const {
    currentMap,
    key,
    hadPreviousValue,
    previousValue,
    optimisticValue,
    attemptId = null,
    currentAttemptId = null,
    valuesEqual = Object.is,
  } = input;

  const source =
    currentMap && typeof currentMap === "object" && !Array.isArray(currentMap)
      ? { ...currentMap }
      : {};

  if (
    attemptId != null &&
    currentAttemptId != null &&
    attemptId !== currentAttemptId
  ) {
    return { map: source, applied: false, reason: "stale_attempt" };
  }

  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return { map: source, applied: false, reason: "key_absent" };
  }

  if (!valuesEqual(source[key], optimisticValue)) {
    return { map: source, applied: false, reason: "value_replaced" };
  }

  const next = { ...source };
  if (hadPreviousValue) {
    next[key] = previousValue;
  } else {
    delete next[key];
  }
  return { map: next, applied: true };
}

/**
 * Garde run / phase / round avant rollback session.
 * Champs absents du capture (= null/undefined) = non vérifiés.
 *
 * @param {{
 *   liveSession?: object|null,
 *   runId?: unknown,
 *   phase?: unknown,
 *   roundIdx?: unknown,
 * }} captured
 * @param {object|null|undefined} liveSession
 */
export function canRollbackOptimisticSubmission(captured = {}, liveSession) {
  if (!liveSession || typeof liveSession !== "object") return false;
  if (captured.runId != null && liveSession.runId !== captured.runId) {
    return false;
  }
  if (captured.phase != null && liveSession.phase !== captured.phase) {
    return false;
  }
  if (
    captured.roundIdx != null &&
    liveSession.roundIdx !== captured.roundIdx
  ) {
    return false;
  }
  return true;
}
