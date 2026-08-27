/**
 * FEATURE-FRIENDS-04 Palier 2 — logique pure (pas de fetch, pas de DOM).
 * Contrats : js/config/recentPeers.js
 */
import { FRIEND_OVERLAY } from "../config/friends.js";
import { recentPeerAction, recentPeerIsInWindow } from "../config/recentPeers.js";

export function normalizeRecentPeerRow(row) {
  if (!row) return null;
  const userId = row.user_id || row.userId;
  if (!userId) return null;
  return {
    userId,
    name: row.display_name || row.name || "Joueur",
    emoji: row.emoji || "👤",
    lastSharedAt: row.last_shared_at || row.lastSharedAt || null,
  };
}

/**
 * Re-filtre client (le SQL omet déjà amis / salon commun / hors 24 h).
 * Sans lastSharedAt : on fait confiance à la RPC.
 */
export function recentPeerKeepListed(
  row,
  {
    localIsRegistered = false,
    currentlyInSameLobby = false,
    alreadyFriends = false,
    now = Date.now(),
  } = {}
) {
  if (!row?.userId) return false;
  if (!localIsRegistered) return false;
  if (currentlyInSameLobby) return false;
  if (alreadyFriends) return false;
  if (row.lastSharedAt && !recentPeerIsInWindow(row.lastSharedAt, now)) return false;
  return true;
}

/** Overlay graphe d’amis existant → action palier 3. */
export function overlayStatusForRecentPeer(
  userId,
  { friends = [], incoming = [], outgoing = [] } = {}
) {
  if (!userId) return FRIEND_OVERLAY.none;
  if ((friends || []).some((row) => row.userId === userId)) return FRIEND_OVERLAY.friends;
  if ((incoming || []).some((row) => row.fromUserId === userId)) {
    return FRIEND_OVERLAY.pendingIn;
  }
  if ((outgoing || []).some((row) => row.toUserId === userId)) {
    return FRIEND_OVERLAY.pendingOut;
  }
  return FRIEND_OVERLAY.none;
}

/** Action bouton d’une ligne croisés (page Amis). */
export function recentPeerRowAction(
  userId,
  graph,
  { localIsRegistered = false, currentlyInSameLobby = false } = {}
) {
  const overlay = overlayStatusForRecentPeer(userId, graph);
  return recentPeerAction(overlay, {
    localIsRegistered,
    currentlyInSameLobby,
    alreadyFriends: overlay === FRIEND_OVERLAY.friends,
  });
}

/** Pas de postgres_changes sur lobby_encounters. Catch-up HTTP seulement. */
export function recentPeersCatchupPlan() {
  return { list: true };
}
