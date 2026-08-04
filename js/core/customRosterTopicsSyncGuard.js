/**
 * FEATURE-TIERNIGHT-02 - garde anti lost-update pour customRosterTopics.
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
 * Choisit la collection la plus complète parmi serveur / cache / local.
 * Évite d'écrire [] quand une source non vide existe encore (fallback client).
 * @param {...unknown[]} candidates
 */
export function pickRichestCustomRosterTopics(...candidates) {
  let best = [];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > best.length) best = c;
  }
  return best;
}

/**
 * Miroir de upsert_game_session_preserving_roster_topics :
 * un replace complet ne doit jamais écraser la collection déjà en base.
 * @param {Record<string, unknown>|null|undefined} incomingState
 * @param {Record<string, unknown>|null|undefined} existingState
 * @param {unknown[]} [localFallback]
 */
export function preserveCustomRosterTopicsInFullStateReplace(
  incomingState,
  existingState,
  localFallback = []
) {
  const incoming =
    incomingState && typeof incomingState === "object" && !Array.isArray(incomingState)
      ? { ...incomingState }
      : {};
  const topics = pickRichestCustomRosterTopics(
    existingState?.customRosterTopics,
    incoming.customRosterTopics,
    localFallback
  );
  return {
    ...incoming,
    customRosterTopics: topics,
  };
}

/** Trace compacte pour diagnostic QA (hôte amputé). */
export function summarizeCustomRosterTopics(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t) => ({
    id: t?.id ?? null,
    name: t?.name ?? null,
    authorUid: t?.authorUid ?? null,
    author: t?.author ?? null,
  }));
}
