/**
 * FEATURE-TIERNIGHT-02 — création / sync thèmes roster (tous les joueurs).
 *
 * Contrat écriture MP : uniquement RPC atomique (hôte = invité).
 * Aucun client ne republie la collection complète via patchGameState.
 */
import {
  createCustomRosterTopicId,
  sanitizeCustomRosterTopicsFromStorage,
  validateRosterTopicName,
} from "./customRosterTopics.js";
import { mergeCustomRosterTopics } from "./sessionMerge.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import { checkHotTakeModeration } from "./hotTakeSession.js";

function mergedTopicsWithLocal(extraLocal = [], localAuthorUid = null) {
  const me = getLocalDisplayName();
  const local = [...(getState().customRosterTopics || []), ...extraLocal];
  return mergeCustomRosterTopics(local, [], me, localAuthorUid);
}

function removeTopicById(list, id) {
  return (list || []).filter((t) => t.id !== id);
}

function restoreTopicIfMissing(list, topic) {
  if (!topic?.id) return list || [];
  if ((list || []).some((t) => t.id === topic.id)) return list;
  return [...(list || []), topic];
}

/**
 * @returns {Promise<{ ok: true, id: string, topic: object }|{ ok: false, error: string }>}
 */
export async function addCustomRosterTopicAndSync({ name }) {
  const nameCheck = validateRosterTopicName(name);
  if (!nameCheck.ok) return nameCheck;

  const mod = checkHotTakeModeration(nameCheck.name);
  if (mod.blocked) return { ok: false, error: mod.message };

  const { isGameSyncActive } = await import("./gameSync.js");
  const { getSupabaseUserId } = await import("./supabaseAuth.js");
  const authorUid = getSupabaseUserId() || null;

  const id = createCustomRosterTopicId();
  const topic = {
    id,
    name: nameCheck.name,
    custom: true,
    author: getLocalDisplayName(),
    ...(authorUid ? { authorUid } : {}),
  };

  // Optimiste local (auteur) — rollback ciblé si RPC échoue.
  saveStatePatch({
    customRosterTopics: mergedTopicsWithLocal([topic], authorUid),
  });

  if (!isGameSyncActive()) return { ok: true, id, topic };

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true, id, topic };

  try {
    const { rpcUpsertPlayerCustomEntry } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
    const row = await rpcUpsertPlayerCustomEntry({
      lobbyId,
      game: "tiernight",
      entry: topic,
    });
    const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
    if (full) applyRemoteSession(full);
    return { ok: true, id, topic };
  } catch (e) {
    const cur = getState().customRosterTopics || [];
    saveStatePatch({ customRosterTopics: removeTopicById(cur, id) });
    return { ok: false, error: e?.message || "Impossible d'enregistrer le thème." };
  }
}

/**
 * @returns {Promise<{ ok: true }|{ ok: false, error?: string }>}
 */
export async function deleteCustomRosterTopicAndSync(id) {
  const me = getLocalDisplayName();
  const { getSupabaseUserId } = await import("./supabaseAuth.js");
  const authorUid = getSupabaseUserId() || null;
  const topics = getState().customRosterTopics || [];
  const target = topics.find((t) => t.id === id);
  if (!target) return { ok: false, error: "Thème introuvable." };

  const owns =
    (authorUid && target.authorUid && String(target.authorUid) === String(authorUid)) ||
    ((!target.authorUid || !authorUid) && (!target.author || target.author === me));
  if (!owns) return { ok: false, error: "Tu ne peux supprimer que tes propres thèmes." };

  saveStatePatch({ customRosterTopics: removeTopicById(topics, id) });

  const { isGameSyncActive } = await import("./gameSync.js");
  if (!isGameSyncActive()) return { ok: true };

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true };

  try {
    const { rpcDeletePlayerCustomEntry } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
    const row = await rpcDeletePlayerCustomEntry({
      lobbyId,
      game: "tiernight",
      entryId: id,
    });
    const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
    if (full) applyRemoteSession(full);
    return { ok: true };
  } catch (e) {
    const cur = getState().customRosterTopics || [];
    saveStatePatch({
      customRosterTopics: restoreTopicIfMissing(cur, target),
    });
    return { ok: false, error: e?.message || "Impossible de supprimer le thème." };
  }
}

/** Helpers tests / lecture. */
export function listCustomRosterTopics() {
  return sanitizeCustomRosterTopicsFromStorage(getState().customRosterTopics);
}
