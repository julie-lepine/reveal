/**
 * FEATURE-FRIENDS-02 Palier 2 — logique pure (pas de fetch, pas de DOM).
 */
import {
  LOBBY_INVITE_LABEL,
  LOBBY_INVITE_RPC_ERROR,
  LOBBY_INVITE_TABLE,
} from "../config/lobbyInvites.js";

export function parseLobbyInviteRpcError(error) {
  const raw = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    typeof error === "string" ? error : "",
  ]
    .filter(Boolean)
    .join(" ");
  const codes = Object.values(LOBBY_INVITE_RPC_ERROR);
  const sorted = [...codes].sort((a, b) => b.length - a.length);
  for (const code of sorted) {
    if (raw.includes(code)) return code;
  }
  return null;
}

export function normalizeIncomingLobbyInviteRow(row) {
  if (!row) return null;
  const id = row.id;
  const fromUserId = row.from_user_id || row.fromUserId;
  const lobbyId = row.lobby_id || row.lobbyId;
  if (!id || !fromUserId || !lobbyId) return null;
  return {
    id,
    lobbyId,
    fromUserId,
    name: row.display_name || row.name || "Joueur",
    emoji: row.emoji || "👤",
    createdAt: row.created_at || row.createdAt || null,
  };
}

export function normalizeOutgoingLobbyInviteRow(row) {
  if (!row) return null;
  const id = row.id;
  const toUserId = row.to_user_id || row.toUserId;
  const lobbyId = row.lobby_id || row.lobbyId;
  if (!id || !toUserId || !lobbyId) return null;
  return { id, lobbyId, toUserId };
}

export function isOutgoingInvitePending(outgoing, lobbyId, toUserId) {
  if (!lobbyId || !toUserId) return false;
  return (outgoing || []).some(
    (row) => row.lobbyId === lobbyId && row.toUserId === toUserId
  );
}

/** INSERT/DELETE lobby_invites sur le même canal `friends:${userId}`. */
export function lobbyInviteRealtimeChangeSpecs(userId) {
  if (!userId) return [];
  return [
    { table: LOBBY_INVITE_TABLE, filter: `to_user_id=eq.${userId}` },
    { table: LOBBY_INVITE_TABLE, filter: `from_user_id=eq.${userId}` },
  ];
}

export function lobbyInvitesCatchupPlan() {
  return { incoming: true, outgoing: true };
}

export function shouldShowLobbyInviteFriendsEntry({
  localIsRegistered = false,
  friendCount = 0,
} = {}) {
  return Boolean(localIsRegistered && friendCount > 0);
}

export function lobbyInviteFailMessage(code) {
  if (code === LOBBY_INVITE_RPC_ERROR.busy) {
    return "Tu es déjà dans une soirée. Tu ne peux en rejoindre qu’une à la fois.";
  }
  if (code === LOBBY_INVITE_RPC_ERROR.full) return "Cette soirée est complète.";
  if (code === LOBBY_INVITE_RPC_ERROR.closed) {
    return "Cette soirée n’est plus disponible.";
  }
  if (code === LOBBY_INVITE_RPC_ERROR.gone) {
    return "Cette invitation n’est plus valable.";
  }
  if (code === LOBBY_INVITE_RPC_ERROR.noLobby) return LOBBY_INVITE_LABEL.noLobbyHint;
  if (code === LOBBY_INVITE_RPC_ERROR.alreadyIn) return LOBBY_INVITE_LABEL.alreadyIn;
  if (code === LOBBY_INVITE_RPC_ERROR.notFriends) return "Vous n’êtes plus amis.";
  return "Impossible de continuer.";
}
