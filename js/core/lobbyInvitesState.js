/**
 * FEATURE-FRIENDS-02 Palier 2 — cache mémoire de session uniquement.
 * Mémoire de session uniquement. Source de vérité = serveur.
 */
import {
  normalizeIncomingLobbyInviteRow,
  normalizeOutgoingLobbyInviteRow,
} from "./lobbyInvitesLogic.js";

/** @type {Array<{ id: string, lobbyId: string, fromUserId: string, name: string, emoji: string, createdAt: string|null }>} */
let incoming = [];
/** @type {Array<{ id: string, lobbyId: string, toUserId: string }>} */
let outgoing = [];
const cacheListeners = new Set();

function emitLobbyInvitesCacheUpdated() {
  for (const fn of cacheListeners) {
    try {
      fn();
    } catch {
      /* listener UI palier 4+ */
    }
  }
}

export function onLobbyInvitesCacheUpdated(fn) {
  cacheListeners.add(fn);
  return () => cacheListeners.delete(fn);
}

export function clearLobbyInvitesCache() {
  incoming = [];
  outgoing = [];
  emitLobbyInvitesCacheUpdated();
}

export function setIncomingLobbyInvites(rows) {
  incoming = (Array.isArray(rows) ? rows : [])
    .map(normalizeIncomingLobbyInviteRow)
    .filter(Boolean);
  emitLobbyInvitesCacheUpdated();
}

export function getIncomingLobbyInvites() {
  return incoming.slice();
}

export function getIncomingLobbyInviteCount() {
  return incoming.length;
}

export function setOutgoingLobbyInvites(rows) {
  outgoing = (Array.isArray(rows) ? rows : [])
    .map(normalizeOutgoingLobbyInviteRow)
    .filter(Boolean);
  emitLobbyInvitesCacheUpdated();
}

export function getOutgoingLobbyInvites() {
  return outgoing.slice();
}

export function isLobbyInvitePendingOut(lobbyId, toUserId) {
  if (!lobbyId || !toUserId) return false;
  return outgoing.some((row) => row.lobbyId === lobbyId && row.toUserId === toUserId);
}

/** Optimistic send. */
export function markLobbyInvitePendingOut(lobbyId, toUserId) {
  if (!lobbyId || !toUserId) return;
  if (isLobbyInvitePendingOut(lobbyId, toUserId)) return;
  outgoing = [...outgoing, { id: `opt:${lobbyId}:${toUserId}`, lobbyId, toUserId }];
  emitLobbyInvitesCacheUpdated();
}

export function removeOutgoingLobbyInvite(lobbyId, toUserId) {
  if (!lobbyId || !toUserId) return;
  outgoing = outgoing.filter(
    (row) => !(row.lobbyId === lobbyId && row.toUserId === toUserId)
  );
  emitLobbyInvitesCacheUpdated();
}
