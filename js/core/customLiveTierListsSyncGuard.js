/**
 * FEATURE-TIERNIGHT-04C - garde anti lost-update pour customLiveTierLists.
 */

import { mergeCustomLiveTierLists } from "./sessionMerge.js";

/**
 * Clear local accepté si epoch remote plus récent, ou writable=false + empty.
 * Distingue clé absente (preserve) d'un clear autoritatif (epoch/writable).
 */
export function shouldAcceptRemoteCustomLiveTierListsEmpty(
  remoteState,
  localList,
  localEpoch
) {
  const remoteEpoch = Number(remoteState?.customLiveTierListsEpoch) || 0;
  if (remoteEpoch > (Number(localEpoch) || 0)) return true;
  if (
    remoteState?.customLiveTierListsWritable === false &&
    Array.isArray(remoteState?.customLiveTierLists) &&
    remoteState.customLiveTierLists.length === 0
  ) {
    return true;
  }
  void localList;
  return false;
}

/**
 * AUDIT-004 — décision d'hydrate customLiveTierLists (pur / testable).
 * Même contrat que resolveCustomRosterTopicsFromRemote.
 *
 * @param {{
 *   remoteList?: unknown[],
 *   localBefore?: unknown[],
 *   localAuthor?: string|null,
 *   localAuthorUid?: string|null,
 *   localEpoch?: number,
 *   remoteState?: object|null,
 * }} input
 */
export function resolveCustomLiveTierListsFromRemote(input = {}) {
  const remoteList = Array.isArray(input.remoteList) ? input.remoteList : [];
  const localBefore = Array.isArray(input.localBefore) ? input.localBefore : [];
  const localEpoch = Number(input.localEpoch) || 0;
  const remoteState = input.remoteState || {};
  const remoteEpoch = Number(remoteState.customLiveTierListsEpoch) || 0;
  const acceptEmpty = shouldAcceptRemoteCustomLiveTierListsEmpty(
    { ...remoteState, customLiveTierLists: remoteList },
    localBefore,
    localEpoch
  );

  if (acceptEmpty || remoteEpoch > localEpoch) {
    return {
      lists: remoteList,
      mode: "authoritative",
      acceptEmpty,
      remoteEpoch,
    };
  }

  if (remoteList.length === 0 && remoteEpoch < localEpoch) {
    return {
      lists: localBefore,
      mode: "keep_local_stale_empty",
      acceptEmpty,
      remoteEpoch,
    };
  }

  return {
    lists: mergeCustomLiveTierLists(
      localBefore,
      remoteList,
      input.localAuthor ?? null,
      input.localAuthorUid ?? null
    ),
    mode: "merge",
    acceptEmpty,
    remoteEpoch,
  };
}

/**
 * Retire customLiveTierLists d'un payload patchGameState générique.
 * @param {Record<string, unknown>|null|undefined} mergePayload
 */
export function stripCustomLiveTierListsFromGenericPatch(mergePayload) {
  if (!mergePayload || typeof mergePayload !== "object" || Array.isArray(mergePayload)) {
    return { safePayload: {}, stripped: false, strippedValue: undefined };
  }
  if (!Object.prototype.hasOwnProperty.call(mergePayload, "customLiveTierLists")) {
    return { safePayload: { ...mergePayload }, stripped: false, strippedValue: undefined };
  }
  const { customLiveTierLists, ...safePayload } = mergePayload;
  return {
    safePayload,
    stripped: true,
    strippedValue: customLiveTierLists,
  };
}

export function pickRichestCustomLiveTierLists(...candidates) {
  let best = [];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > best.length) best = c;
  }
  return best;
}

/**
 * Miroir SQL preserve : replace complet ne doit pas amputer customLiveTierLists.
 */
export function preserveCustomLiveTierListsInFullStateReplace(
  incomingState,
  existingState,
  localFallback = []
) {
  const incoming =
    incomingState && typeof incomingState === "object" && !Array.isArray(incomingState)
      ? { ...incomingState }
      : {};
  const lists = pickRichestCustomLiveTierLists(
    existingState?.customLiveTierLists,
    incoming.customLiveTierLists,
    localFallback
  );
  const out = {
    ...incoming,
    customLiveTierLists: lists,
  };
  // Epoch / writable serveur prioritaire si présents.
  if (existingState && typeof existingState === "object") {
    if (existingState.customLiveTierListsEpoch != null) {
      out.customLiveTierListsEpoch = existingState.customLiveTierListsEpoch;
    }
    if (
      existingState.customLiveTierListsWritable === true ||
      existingState.customLiveTierListsWritable === false
    ) {
      out.customLiveTierListsWritable = existingState.customLiveTierListsWritable;
    }
  }
  return out;
}

export function summarizeCustomLiveTierLists(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t) => ({
    id: t?.id ?? null,
    name: t?.name ?? null,
    authorUid: t?.authorUid ?? null,
    author: t?.author ?? null,
    itemCount: Array.isArray(t?.items) ? t.items.length : 0,
  }));
}
