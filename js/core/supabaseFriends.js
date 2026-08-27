/**
 * FEATURE-FRIENDS-01 Palier 2 — wrappers RPC. Pas d’UI.
 * Invité / hors backend : no-op (skipped). Cooldown : ok:false sans throw.
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getState } from "./state.js";
import { FRIEND_RPC, FRIEND_RPC_ERROR } from "../config/friends.js";
import {
  isRegisteredUser,
  isSilentFriendRpcCode,
  overlayEntriesToMap,
  parseFriendRpcError,
} from "./friendsLogic.js";
import {
  setIncomingFriendRequests,
  setLobbyFriendOverlay,
  setMyFriends,
} from "./friendsState.js";

function canCallFriendsRpc() {
  return Boolean(
    isSupabaseConfigured() && supabase && isRegisteredUser(getState().user)
  );
}

function friendError(error) {
  const code = parseFriendRpcError(error);
  const err = new Error(code || error?.message || "friends_rpc");
  err.code = code;
  err.cause = error;
  return err;
}

async function callRpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw friendError(error);
  return data;
}

export async function sendFriendRequest(toUserId) {
  if (!canCallFriendsRpc() || !toUserId) return { ok: false, skipped: true };
  try {
    const data = await callRpc(FRIEND_RPC.send, { p_to: toUserId });
    return { ok: true, result: data?.result || "pending" };
  } catch (err) {
    if (isSilentFriendRpcCode(err.code)) {
      return { ok: false, code: FRIEND_RPC_ERROR.cooldown };
    }
    throw err;
  }
}

export async function declineFriendRequest(fromUserId) {
  if (!canCallFriendsRpc() || !fromUserId) return { ok: false, skipped: true };
  const data = await callRpc(FRIEND_RPC.decline, { p_from: fromUserId });
  return { ok: true, result: data?.result || "declined" };
}

export async function acceptFriendRequest(fromUserId) {
  if (!canCallFriendsRpc() || !fromUserId) return { ok: false, skipped: true };
  const data = await callRpc(FRIEND_RPC.accept, { p_from: fromUserId });
  return { ok: true, result: data?.result || "friends" };
}

export async function unfriendUser(otherUserId) {
  if (!canCallFriendsRpc() || !otherUserId) return { ok: false, skipped: true };
  const data = await callRpc(FRIEND_RPC.unfriend, { p_other: otherUserId });
  return { ok: true, result: data?.result || "ok" };
}

export async function fetchLobbyFriendOverlay(lobbyId) {
  if (!canCallFriendsRpc() || !lobbyId) {
    setLobbyFriendOverlay(null, {});
    return { ok: false, skipped: true, map: {} };
  }
  const data = await callRpc(FRIEND_RPC.overlay, { p_lobby_id: lobbyId });
  const map = overlayEntriesToMap(data);
  setLobbyFriendOverlay(lobbyId, map);
  return { ok: true, map };
}

export async function fetchMyFriends() {
  if (!canCallFriendsRpc()) {
    setMyFriends([]);
    return { ok: false, skipped: true, friends: [] };
  }
  const data = await callRpc(FRIEND_RPC.listFriends, {});
  setMyFriends(data);
  return { ok: true, friends: data };
}

export async function fetchIncomingFriendRequests() {
  if (!canCallFriendsRpc()) {
    setIncomingFriendRequests([]);
    return { ok: false, skipped: true, incoming: [] };
  }
  const data = await callRpc(FRIEND_RPC.listIncoming, {});
  setIncomingFriendRequests(data);
  return { ok: true, incoming: data };
}
