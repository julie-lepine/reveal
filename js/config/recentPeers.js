/**
 * FEATURE-FRIENDS-04 Palier 0 — contrats « Vous venez de jouer avec ».
 * Aligné sur docs/FRIENDS.md § Phase 4. Pas de fetch, de Realtime, ni de DOM.
 * Le graphe d’amis / Annuler : `js/config/friends.js`. Invitations : `lobbyInvites.js`.
 */

import { FRIEND_OVERLAY, FRIEND_ROSTER_ACTION } from "./friends.js";

export const FRIENDS_04_FEATURE_ID = "FEATURE-FRIENDS-04";

/** Fenêtre après la fin du chevauchement (leave / dissolve). */
export const RECENT_PEERS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Table dédiée. Pas de colonnes d’amitié / d’invite sur lobby_members. */
export const RECENT_PEERS_TABLE = "lobby_encounters";

/**
 * Paire ordonnée user_a < user_b. last_shared_at = dernier moment co-membres.
 * Écriture serveur (trigger membership). Pas d’INSERT client. CASCADE compte.
 */
export const RECENT_PEERS_PAIR_ORDER = "user_a < user_b";

/** RPC SECURITY DEFINER, authenticated, refuse is_anonymous. Pas le code salon. */
export const RECENT_PEERS_RPC = {
  list: "list_recent_lobby_peers",
};

export const RECENT_PEERS_LABEL = {
  section: "Vous venez de jouer avec",
  empty: "Personne récemment.",
};

/**
 * Action sur une ligne de la section (page Amis).
 * Hors graphe d’invites F02 : pas d’action d’invitation de soirée ici.
 */
export const RECENT_PEER_ACTION = {
  omit: "omit",
  add: FRIEND_ROSTER_ACTION.add,
  cancel: FRIEND_ROSTER_ACTION.cancel,
  accept: FRIEND_ROSTER_ACTION.accept,
};

/**
 * @param {string} userIdA
 * @param {string} userIdB
 * @returns {{ userA: string, userB: string }|null}
 */
export function encounterPair(userIdA, userIdB) {
  const a = String(userIdA || "").trim();
  const b = String(userIdB || "").trim();
  if (!a || !b || a === b) return null;
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

/**
 * Encore dans le même lobby → la liste croisés ne s’en occupe pas (roster).
 * @param {string|number|Date|null|undefined} lastSharedAt
 * @param {number} [now]
 * @param {number} [windowMs]
 */
export function recentPeerIsInWindow(
  lastSharedAt,
  now = Date.now(),
  windowMs = RECENT_PEERS_WINDOW_MS
) {
  if (lastSharedAt == null || lastSharedAt === "") return false;
  const t = new Date(lastSharedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= 0 && age <= windowMs;
}

/**
 * Qui **n’apparaît pas** dans la section (le SQL omet aussi ; le client re-filtre).
 * @param {{
 *   localIsRegistered?: boolean,
 *   peerIsRegistered?: boolean,
 *   currentlyInSameLobby?: boolean,
 *   alreadyFriends?: boolean,
 *   lastSharedAt?: string|number|Date|null,
 *   now?: number,
 * }} opts
 */
export function recentPeerShouldList({
  localIsRegistered = false,
  peerIsRegistered = false,
  currentlyInSameLobby = false,
  alreadyFriends = false,
  lastSharedAt = null,
  now = Date.now(),
} = {}) {
  if (!localIsRegistered || !peerIsRegistered) return false;
  if (currentlyInSameLobby) return false;
  if (alreadyFriends) return false;
  return recentPeerIsInWindow(lastSharedAt, now);
}

/**
 * Overlay ami → bouton de la ligne. Invité / ami / encore ensemble → omit.
 * pending_out = **Annuler** (FEATURE-FRIENDS-03 live).
 * @param {string|null|undefined} overlayStatus
 * @param {{
 *   localIsRegistered?: boolean,
 *   currentlyInSameLobby?: boolean,
 *   alreadyFriends?: boolean,
 * }} opts
 */
export function recentPeerAction(
  overlayStatus,
  {
    localIsRegistered = false,
    currentlyInSameLobby = false,
    alreadyFriends = false,
  } = {}
) {
  if (!localIsRegistered) return RECENT_PEER_ACTION.omit;
  if (currentlyInSameLobby) return RECENT_PEER_ACTION.omit;
  if (alreadyFriends || overlayStatus === FRIEND_OVERLAY.friends) {
    return RECENT_PEER_ACTION.omit;
  }
  if (overlayStatus === FRIEND_OVERLAY.guest || overlayStatus == null) {
    return RECENT_PEER_ACTION.omit;
  }
  if (overlayStatus === FRIEND_OVERLAY.pendingIn) return RECENT_PEER_ACTION.accept;
  if (overlayStatus === FRIEND_OVERLAY.pendingOut) return RECENT_PEER_ACTION.cancel;
  if (overlayStatus === FRIEND_OVERLAY.none) return RECENT_PEER_ACTION.add;
  return RECENT_PEER_ACTION.omit;
}
