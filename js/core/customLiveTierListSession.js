/**
 * FEATURE-TIERNIGHT-04C - création / sync customs Rank Live partagés.
 *
 * Contrat écriture MP : uniquement RPC atomiques dédiées.
 * Aucun client ne republie la collection via patchGameState.
 * Ready ne verrouille pas ; le launch verrouille (predicate + SQL).
 */
import {
  createCustomLiveTierListId,
  sanitizeCustomLiveTierListsCollection,
  validateCustomLiveTierList,
} from "./customLiveTierLists.js";
import {
  isCustomLiveTierListOwnedBy,
  mergeCustomLiveTierLists,
} from "./sessionMerge.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import { checkHotTakeModeration } from "./hotTakeModeration.js";
import {
  isLocalTierNightLiveCustomPoolWritable,
  isTierNightLiveCustomPoolWritable,
} from "./tierNightLiveCustomPoolLock.js";
import { shouldAcceptRemoteCustomLiveTierListsEmpty } from "./customLiveTierListsSyncGuard.js";

export {
  isTierNightLiveCustomPoolWritable,
  isLocalTierNightLiveCustomPoolWritable,
  shouldAcceptRemoteCustomLiveTierListsEmpty,
};

/**
 * Modère name + tous les items (1 appel local pur par string - coût négligeable).
 * Arrêt au premier refus.
 * @param {{ name?: string, items?: string[] }} content
 * @returns {{ blocked: false }|{ blocked: true, message: string, field: string, index?: number }}
 */
export function moderateCustomLiveTierListContent(content = {}) {
  const name = String(content.name ?? "").trim();
  const nameMod = checkHotTakeModeration(name);
  if (nameMod.blocked) {
    return { blocked: true, message: nameMod.message, field: "name" };
  }
  const items = Array.isArray(content.items) ? content.items : [];
  for (let i = 0; i < items.length; i += 1) {
    const item = String(items[i] ?? "").trim();
    const mod = checkHotTakeModeration(item);
    if (mod.blocked) {
      return { blocked: true, message: mod.message, field: "item", index: i };
    }
  }
  return { blocked: false };
}

function removeListById(list, id) {
  return (list || []).filter((t) => t.id !== id);
}

function restoreListIfMissing(list, entry) {
  if (!entry?.id) return list || [];
  if ((list || []).some((t) => t.id === entry.id)) return list;
  return [...(list || []), entry];
}

function mergedListsWithLocal(extraLocal = [], localAuthorUid = null) {
  const me = getLocalDisplayName();
  const local = [...(getState().customLiveTierLists || []), ...extraLocal];
  return mergeCustomLiveTierLists(local, [], me, localAuthorUid);
}

function mapRpcError(error) {
  const msg = String(error?.message || error || "");
  if (msg.includes("TNS_LIVE_CUSTOM_LOCKED")) {
    return "Le pool de tier lists est verrouillé : la série a déjà commencé.";
  }
  if (msg.includes("TNS_LIVE_CUSTOM_NOT_OWNER")) {
    return "Tu ne peux modifier que tes propres tier lists.";
  }
  if (msg.includes("TNS_LIVE_CUSTOM_EDIT_FORBIDDEN")) {
    return "Modification interdite : crée une nouvelle liste ou supprime l'ancienne.";
  }
  if (msg.includes("trop volumineuse")) {
    return "Cette tier list est trop volumineuse.";
  }
  return msg || "Impossible d'enregistrer la tier list.";
}

export function readLocalCustomLiveWritable(stateLike = getState()) {
  return stateLike?.customLiveTierListsWritable !== false;
}

/**
 * @param {{ name: string, emoji?: string, items: string[] }} input
 * @returns {Promise<{ ok: true, id: string, list: object }|{ ok: false, error: string, code?: string }>}
 */
export async function addCustomLiveTierListAndSync(input) {
  const { getSupabaseUserId } = await import("./supabaseAuth.js");
  const authorUid = getSupabaseUserId() || null;
  if (!authorUid) {
    return { ok: false, error: "Authentification requise.", code: "AUTH_REQUIRED" };
  }

  const draft = {
    id: createCustomLiveTierListId(),
    name: input?.name,
    emoji: input?.emoji,
    items: input?.items,
    author: getLocalDisplayName(),
    authorUid,
    custom: true,
  };

  const validated = validateCustomLiveTierList(draft);
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.message || validated.code || "Tier list invalide.",
      code: validated.code,
    };
  }

  const mod = moderateCustomLiveTierListContent(validated.list);
  if (mod.blocked) {
    return { ok: false, error: mod.message, code: "MODERATION_BLOCKED" };
  }

  const st = getState();
  if (
    !isLocalTierNightLiveCustomPoolWritable({
      customLiveTierListsWritable: st.customLiveTierListsWritable,
      tierNightLiveGame: st.tierNightLiveGame,
    })
  ) {
    return {
      ok: false,
      error: "Le pool de tier lists est verrouillé : la série a déjà commencé.",
      code: "TNS_LIVE_CUSTOM_LOCKED",
    };
  }

  const list = validated.list;
  saveStatePatch({
    customLiveTierLists: mergedListsWithLocal([list], authorUid),
  });

  const { isGameSyncActive } = await import("./gameSync.js");
  if (!isGameSyncActive()) return { ok: true, id: list.id, list };

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true, id: list.id, list };

  try {
    const { rpcUpsertPlayerCustomLiveTierList } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
    const row = await rpcUpsertPlayerCustomLiveTierList({
      lobbyId,
      entry: list,
    });
    const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
    if (full) applyRemoteSession(full);
    return { ok: true, id: list.id, list };
  } catch (e) {
    const cur = getState().customLiveTierLists || [];
    saveStatePatch({ customLiveTierLists: removeListById(cur, list.id) });
    return { ok: false, error: mapRpcError(e), code: "RPC_FAILED" };
  }
}

/**
 * @param {string} id
 * @returns {Promise<{ ok: true }|{ ok: false, error?: string, code?: string }>}
 */
export async function deleteCustomLiveTierListAndSync(id) {
  const me = getLocalDisplayName();
  const { getSupabaseUserId } = await import("./supabaseAuth.js");
  const authorUid = getSupabaseUserId() || null;
  const lists = getState().customLiveTierLists || [];
  const target = lists.find((t) => t.id === id);
  if (!target) return { ok: false, error: "Tier list introuvable.", code: "NOT_FOUND" };

  if (!isCustomLiveTierListOwnedBy(target, me, authorUid)) {
    return {
      ok: false,
      error: "Tu ne peux supprimer que tes propres tier lists.",
      code: "TNS_LIVE_CUSTOM_NOT_OWNER",
    };
  }

  const st = getState();
  if (
    !isLocalTierNightLiveCustomPoolWritable({
      customLiveTierListsWritable: st.customLiveTierListsWritable,
      tierNightLiveGame: st.tierNightLiveGame,
    })
  ) {
    return {
      ok: false,
      error: "Le pool de tier lists est verrouillé : la série a déjà commencé.",
      code: "TNS_LIVE_CUSTOM_LOCKED",
    };
  }

  saveStatePatch({ customLiveTierLists: removeListById(lists, id) });

  const { isGameSyncActive } = await import("./gameSync.js");
  if (!isGameSyncActive()) return { ok: true };

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true };

  try {
    const { rpcDeletePlayerCustomLiveTierList } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
    const row = await rpcDeletePlayerCustomLiveTierList({
      lobbyId,
      entryId: id,
    });
    const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
    if (full) applyRemoteSession(full);
    return { ok: true };
  } catch (e) {
    const cur = getState().customLiveTierLists || [];
    saveStatePatch({
      customLiveTierLists: restoreListIfMissing(cur, target),
    });
    return { ok: false, error: mapRpcError(e), code: "RPC_FAILED" };
  }
}

/** Lecture locale sanitizée. */
export function listCustomLiveTierLists() {
  return sanitizeCustomLiveTierListsCollection(getState().customLiveTierLists);
}

export function clearCustomLiveTierListsLocal() {
  const cur = getState().customLiveTierLists || [];
  if (!Array.isArray(cur) || cur.length === 0) {
    return { cleared: false, alreadyEmpty: true };
  }
  saveStatePatch({ customLiveTierLists: [] });
  return { cleared: true, alreadyEmpty: false };
}
