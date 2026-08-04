/**
 * FEATURE-TIERNIGHT-02 — création / sync thèmes roster (tous les joueurs).
 * Aligné Hot Take / Dilemma : hôte → patchGameState ; invité → RPC custom entry.
 */
import {
  createCustomRosterTopicId,
  sanitizeCustomRosterTopicsFromStorage,
  validateRosterTopicName,
} from "./customRosterTopics.js";
import { mergeCustomRosterTopics } from "./sessionMerge.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";

function mergedTopicsWithLocal(extraLocal = []) {
  const me = getLocalDisplayName();
  const local = [...(getState().customRosterTopics || []), ...extraLocal];
  return mergeCustomRosterTopics(local, [], me);
}

/**
 * @returns {Promise<{ ok: true, id: string, topic: object }|{ ok: false, error: string }>}
 */
export async function addCustomRosterTopicAndSync({ name }) {
  const nameCheck = validateRosterTopicName(name);
  if (!nameCheck.ok) return nameCheck;

  const id = createCustomRosterTopicId();
  const topic = {
    id,
    name: nameCheck.name,
    custom: true,
    author: getLocalDisplayName(),
  };
  const merged = mergedTopicsWithLocal([topic]);
  saveStatePatch({ customRosterTopics: merged });

  const { isGameSyncActive, isLobbyHost, patchGameState, getCachedGameSession } = await import(
    "./gameSync.js"
  );
  if (!isGameSyncActive()) return { ok: true, id, topic };

  const remoteCached = getCachedGameSession()?.state?.customRosterTopics || [];
  const published = mergeCustomRosterTopics(merged, remoteCached, getLocalDisplayName());
  saveStatePatch({ customRosterTopics: published });

  if (isLobbyHost()) {
    await patchGameState({ customRosterTopics: published });
    return { ok: true, id, topic };
  }

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true, id, topic };

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
}

/**
 * @returns {Promise<boolean>}
 */
export async function deleteCustomRosterTopicAndSync(id) {
  const me = getLocalDisplayName();
  const topics = getState().customRosterTopics || [];
  const target = topics.find((t) => t.id === id);
  if (!target) return false;
  if (target.author && target.author !== me) return false;

  const next = topics.filter((t) => t.id !== id);
  saveStatePatch({ customRosterTopics: next });

  const { isGameSyncActive, isLobbyHost, patchGameState } = await import("./gameSync.js");
  if (!isGameSyncActive()) return true;

  if (isLobbyHost()) {
    await patchGameState({ customRosterTopics: next });
    return true;
  }

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return true;

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
  return true;
}

/** Helpers tests / lecture. */
export function listCustomRosterTopics() {
  return sanitizeCustomRosterTopicsFromStorage(getState().customRosterTopics);
}
