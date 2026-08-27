/**
 * FEATURE-FRIENDS-04 Palier 2 — cache mémoire de session uniquement.
 * Pas de persist navigateur. Source de vérité = RPC list.
 */
import { normalizeRecentPeerRow } from "./recentPeersLogic.js";

/** @type {Array<{ userId: string, name: string, emoji: string, lastSharedAt: string|null }>} */
let peers = [];
const cacheListeners = new Set();

function emitRecentPeersCacheUpdated() {
  for (const fn of cacheListeners) {
    try {
      fn();
    } catch {
      /* listener UI palier 3 */
    }
  }
}

export function onRecentPeersCacheUpdated(fn) {
  cacheListeners.add(fn);
  return () => cacheListeners.delete(fn);
}

export function clearRecentPeersCache() {
  peers = [];
  emitRecentPeersCacheUpdated();
}

export function setRecentLobbyPeers(rows) {
  peers = (Array.isArray(rows) ? rows : [])
    .map(normalizeRecentPeerRow)
    .filter(Boolean);
  emitRecentPeersCacheUpdated();
}

export function getRecentLobbyPeers() {
  return peers.slice();
}
