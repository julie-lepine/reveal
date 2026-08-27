/**
 * FEATURE-FRIENDS-02 Palier 2 — wrappers RPC. Pas d’UI.
 * Invité / hors backend : no-op (skipped).
 * Outgoing : SELECT RLS (from_user_id = moi), pas un 5e RPC.
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getState } from "./state.js";
import { LOBBY_INVITE_RPC, LOBBY_INVITE_TABLE } from "../config/lobbyInvites.js";
import { isRegisteredUser } from "./friendsLogic.js";
import { parseLobbyInviteRpcError } from "./lobbyInvitesLogic.js";
import {
  markLobbyInvitePendingOut,
  removeOutgoingLobbyInvite,
  setIncomingLobbyInvites,
  setOutgoingLobbyInvites,
} from "./lobbyInvitesState.js";

function canCallLobbyInviteRpc() {
  return Boolean(
    isSupabaseConfigured() && supabase && isRegisteredUser(getState().user)
  );
}

function inviteError(error) {
  const code = parseLobbyInviteRpcError(error);
  const err = new Error(code || error?.message || "lobby_invite_rpc");
  err.code = code;
  err.cause = error;
  return err;
}

async function callRpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw inviteError(error);
  return data;
}

export async function sendLobbyInvite(toUserId) {
  if (!canCallLobbyInviteRpc() || !toUserId) return { ok: false, skipped: true };
  const lobbyId = getState().lobby?.id || null;
  try {
    const data = await callRpc(LOBBY_INVITE_RPC.send, { p_to: toUserId });
    if (lobbyId) markLobbyInvitePendingOut(lobbyId, toUserId);
    return { ok: true, result: data?.result || "pending" };
  } catch (err) {
    if (lobbyId) removeOutgoingLobbyInvite(lobbyId, toUserId);
    throw err;
  }
}

export async function declineLobbyInvite(inviteId) {
  if (!canCallLobbyInviteRpc() || !inviteId) return { ok: false, skipped: true };
  const data = await callRpc(LOBBY_INVITE_RPC.decline, { p_id: inviteId });
  return { ok: true, result: data?.result || "declined" };
}

export async function acceptLobbyInvite(inviteId) {
  if (!canCallLobbyInviteRpc() || !inviteId) return { ok: false, skipped: true };
  const data = await callRpc(LOBBY_INVITE_RPC.accept, { p_id: inviteId });
  return {
    ok: true,
    result: data?.result || "joined",
    lobbyId: data?.lobby_id || data?.lobbyId || null,
  };
}

export async function fetchIncomingLobbyInvites() {
  if (!canCallLobbyInviteRpc()) {
    setIncomingLobbyInvites([]);
    return { ok: false, skipped: true, incoming: [] };
  }
  const data = await callRpc(LOBBY_INVITE_RPC.listIncoming, {});
  setIncomingLobbyInvites(data);
  return { ok: true, incoming: data };
}

export async function fetchOutgoingLobbyInvites() {
  if (!canCallLobbyInviteRpc()) {
    setOutgoingLobbyInvites([]);
    return { ok: false, skipped: true, outgoing: [] };
  }
  const uid = getState().supabaseUserId;
  if (!uid) {
    setOutgoingLobbyInvites([]);
    return { ok: false, skipped: true, outgoing: [] };
  }
  const { data, error } = await supabase
    .from(LOBBY_INVITE_TABLE)
    .select("id, lobby_id, to_user_id")
    .eq("from_user_id", uid);
  if (error) throw inviteError(error);
  setOutgoingLobbyInvites(data);
  return { ok: true, outgoing: data };
}
