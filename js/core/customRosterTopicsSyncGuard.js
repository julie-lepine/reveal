/**
 * FEATURE-TIERNIGHT-02 — garde anti lost-update pour customRosterTopics.
 *
 * La collection n'est jamais réécrite via patch générique client.
 * Remplacement complet de state → préserver la valeur serveur (miroir SQL).
 */

/**
 * Retire customRosterTopics d'un payload patchGameState générique.
 * @param {Record<string, unknown>|null|undefined} mergePayload
 * @returns {{ safePayload: Record<string, unknown>, stripped: boolean, strippedValue: unknown }}
 */
export function stripCustomRosterTopicsFromGenericPatch(mergePayload) {
  if (!mergePayload || typeof mergePayload !== "object" || Array.isArray(mergePayload)) {
    return { safePayload: {}, stripped: false, strippedValue: undefined };
  }
  if (!Object.prototype.hasOwnProperty.call(mergePayload, "customRosterTopics")) {
    return { safePayload: { ...mergePayload }, stripped: false, strippedValue: undefined };
  }
  const { customRosterTopics, ...safePayload } = mergePayload;
  return {
    safePayload,
    stripped: true,
    strippedValue: customRosterTopics,
  };
}

/**
 * Miroir de upsert_game_session_preserving_roster_topics :
 * un replace complet ne doit jamais écraser la collection déjà en base.
 * @param {Record<string, unknown>|null|undefined} incomingState
 * @param {Record<string, unknown>|null|undefined} existingState
 */
export function preserveCustomRosterTopicsInFullStateReplace(incomingState, existingState) {
  const incoming =
    incomingState && typeof incomingState === "object" && !Array.isArray(incomingState)
      ? { ...incomingState }
      : {};
  const existingTopics = Array.isArray(existingState?.customRosterTopics)
    ? existingState.customRosterTopics
    : [];
  return {
    ...incoming,
    customRosterTopics: existingTopics,
  };
}
