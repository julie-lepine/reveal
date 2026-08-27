/**
 * FEATURE-FRIENDS-01 Palier 2 — cache mémoire de session uniquement.
 * Le graphe n’est pas écrit dans le persist app : source de vérité = serveur.
 */
import { FRIEND_OVERLAY } from "../config/friends.js";
import { normalizeFriendRow, normalizeIncomingRequestRow } from "./friendsLogic.js";

let overlayLobbyId = null;
/** @type {Record<string, string>} */
let overlayByUserId = Object.create(null);
/** @type {Array<{ userId: string, name: string, emoji: string }>} */
let friends = [];
/** @type {Array<{ id: string, fromUserId: string, name: string, emoji: string, createdAt: string|null }>} */
let incoming = [];
const cacheListeners = new Set();

function emitFriendsCacheUpdated() {
  for (const fn of cacheListeners) {
    try {
      fn();
    } catch {
      /* listener UI */
    }
  }
}

/** Palier 4+ : roster / page Amis se réabonnent ici. */
export function onFriendsCacheUpdated(fn) {
  cacheListeners.add(fn);
  return () => cacheListeners.delete(fn);
}

export function clearFriendsCache() {
  overlayLobbyId = null;
  overlayByUserId = Object.create(null);
  friends = [];
  incoming = [];
  emitFriendsCacheUpdated();
}

export function setLobbyFriendOverlay(lobbyId, map) {
  overlayLobbyId = lobbyId || null;
  overlayByUserId = map && typeof map === "object" ? { ...map } : Object.create(null);
  emitFriendsCacheUpdated();
}

export function getLobbyFriendOverlayStatus(lobbyId, userId) {
  if (!lobbyId || !userId || overlayLobbyId !== lobbyId) return null;
  return overlayByUserId[userId] ?? null;
}

export function patchLobbyFriendOverlayStatus(lobbyId, userId, status) {
  if (!lobbyId || !userId || overlayLobbyId !== lobbyId) return;
  overlayByUserId = { ...overlayByUserId, [userId]: status };
  emitFriendsCacheUpdated();
}

/** Optimistic send : none → pending_out. Retourne le statut précédent (rollback). */
export function markOverlayPendingOut(lobbyId, userId) {
  const prev = getLobbyFriendOverlayStatus(lobbyId, userId);
  if (overlayLobbyId !== lobbyId) return prev;
  overlayByUserId = {
    ...overlayByUserId,
    [userId]: FRIEND_OVERLAY.pendingOut,
  };
  emitFriendsCacheUpdated();
  return prev;
}

export function setMyFriends(rows) {
  friends = (Array.isArray(rows) ? rows : [])
    .map(normalizeFriendRow)
    .filter(Boolean);
  emitFriendsCacheUpdated();
}

export function getMyFriends() {
  return friends.slice();
}

export function setIncomingFriendRequests(rows) {
  incoming = (Array.isArray(rows) ? rows : [])
    .map(normalizeIncomingRequestRow)
    .filter(Boolean);
  emitFriendsCacheUpdated();
}

export function getIncomingFriendRequests() {
  return incoming.slice();
}

export function getIncomingFriendRequestCount() {
  return incoming.length;
}
