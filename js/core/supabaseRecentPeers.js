/**
 * FEATURE-FRIENDS-04 Palier 2 — wrapper RPC. Pas d’UI.
 * Invité / hors backend : no-op (skipped). Pas d’INSERT table.
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getState } from "./state.js";
import { RECENT_PEERS_RPC } from "../config/recentPeers.js";
import { isRegisteredUser, parseFriendRpcError } from "./friendsLogic.js";
import { getMyFriends } from "./friendsState.js";
import { normalizeRecentPeerRow, recentPeerKeepListed } from "./recentPeersLogic.js";
import { setRecentLobbyPeers } from "./recentPeersState.js";

function canCallRecentPeersRpc() {
  return Boolean(
    isSupabaseConfigured() && supabase && isRegisteredUser(getState().user)
  );
}

function recentPeersError(error) {
  const code = parseFriendRpcError(error);
  const err = new Error(code || error?.message || "recent_peers_rpc");
  err.code = code;
  err.cause = error;
  return err;
}

function sameLobbyUserIds() {
  const ids = new Set();
  const participants = getState().lobby?.participants || [];
  for (const p of participants) {
    if (p?.userId) ids.add(p.userId);
  }
  return ids;
}

export async function fetchRecentLobbyPeers() {
  if (!canCallRecentPeersRpc()) {
    setRecentLobbyPeers([]);
    return { ok: false, skipped: true, peers: [] };
  }
  const { data, error } = await supabase.rpc(RECENT_PEERS_RPC.list, {});
  if (error) throw recentPeersError(error);

  const friendIds = new Set(getMyFriends().map((row) => row.userId));
  const sameLobby = sameLobbyUserIds();
  const localIsRegistered = isRegisteredUser(getState().user);
  const peers = (Array.isArray(data) ? data : [])
    .map(normalizeRecentPeerRow)
    .filter(Boolean)
    .filter((row) =>
      recentPeerKeepListed(row, {
        localIsRegistered,
        alreadyFriends: friendIds.has(row.userId),
        currentlyInSameLobby: sameLobby.has(row.userId),
      })
    );
  setRecentLobbyPeers(peers);
  return { ok: true, peers };
}
