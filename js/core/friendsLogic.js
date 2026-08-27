/**
 * FEATURE-FRIENDS-01 Palier 2 — logique pure (pas de fetch, pas de DOM).
 * Même prédicat que isLoggedIn() dans auth.js, sans l’importer (évite un cycle
 * auth → lobby → friends au palier 4).
 */
import {
  FRIEND_LABEL,
  FRIEND_OVERLAY,
  FRIEND_OVERLAY_STATUSES,
  FRIEND_ROSTER_ACTION,
  FRIEND_RPC_ERROR,
  FRIENDS_SCREEN_ID,
  FRIENDS_TABLE,
  isFriendNoticeCalmScreen,
  rosterActionFromOverlay,
} from "../config/friends.js";

export function isRegisteredUser(user) {
  return Boolean(user?.loggedIn && !user?.isGuest);
}

/** Codes métier PostgREST (message / details / hint). */
export function parseFriendRpcError(error) {
  const raw = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    typeof error === "string" ? error : "",
  ]
    .filter(Boolean)
    .join(" ");
  for (const code of Object.values(FRIEND_RPC_ERROR)) {
    if (raw.includes(code)) return code;
  }
  return null;
}

/** Cooldown : bouton reste Ajouter, aucun toast. */
export function isSilentFriendRpcCode(code) {
  return code === FRIEND_RPC_ERROR.cooldown;
}

export function overlayEntriesToMap(data) {
  const list = Array.isArray(data) ? data : [];
  const map = Object.create(null);
  for (const row of list) {
    const userId = row?.user_id || row?.userId;
    const status = row?.status;
    if (!userId || !FRIEND_OVERLAY_STATUSES.includes(status)) continue;
    map[userId] = status;
  }
  return map;
}

export function overlayStatusAfterSilentFailure(previous) {
  return previous == null ? FRIEND_OVERLAY.none : previous;
}

export function rosterLabelFromAction(action) {
  switch (action) {
    case FRIEND_ROSTER_ACTION.add:
      return FRIEND_LABEL.add;
    case FRIEND_ROSTER_ACTION.sent:
      return FRIEND_LABEL.sent;
    case FRIEND_ROSTER_ACTION.accept:
      return FRIEND_LABEL.accept;
    case FRIEND_ROSTER_ACTION.friend:
      return FRIEND_LABEL.friend;
    case FRIEND_ROSTER_ACTION.hintGuest:
      return FRIEND_LABEL.guestCard;
    default:
      return FRIEND_LABEL.guestCard;
  }
}

export function rosterActionForPeer(overlayStatus, localIsRegistered) {
  return rosterActionFromOverlay(overlayStatus, { localIsRegistered });
}

export function normalizeFriendRow(row) {
  if (!row) return null;
  const userId = row.user_id || row.userId;
  if (!userId) return null;
  return {
    userId,
    name: row.display_name || row.name || "Joueur",
    emoji: row.emoji || "👤",
  };
}

export function normalizeIncomingRequestRow(row) {
  if (!row) return null;
  const fromUserId = row.from_user_id || row.fromUserId;
  const id = row.id;
  if (!fromUserId || !id) return null;
  return {
    id,
    fromUserId,
    name: row.display_name || row.name || "Joueur",
    emoji: row.emoji || "👤",
    createdAt: row.created_at || row.createdAt || null,
  };
}

/** Quatre écoutes : incoming + outgoing requests, friendships des deux côtés. */
export function friendsRealtimeChangeSpecs(userId) {
  if (!userId) return [];
  return [
    { table: FRIENDS_TABLE.requests, filter: `to_user_id=eq.${userId}` },
    { table: FRIENDS_TABLE.requests, filter: `from_user_id=eq.${userId}` },
    { table: FRIENDS_TABLE.friendships, filter: `user_a=eq.${userId}` },
    { table: FRIENDS_TABLE.friendships, filter: `user_b=eq.${userId}` },
  ];
}

/**
 * Catch-up HTTP après event Realtime.
 * Overlay seulement en lobby. Incoming + liste amis toujours (popup palier 5).
 */
export function friendsCatchupPlan({ inLobby, lobbyId } = {}) {
  return {
    overlay: Boolean(inLobby && lobbyId),
    incoming: true,
    friends: true,
  };
}

/**
 * Action roster waiting room. `omit` = rien sur la carte (soi, loading, local invité).
 * @returns {"omit"|"hint_guest"|"add"|"sent"|"accept"|"friend"}
 */
export function peerFriendRosterKind(overlayStatus, { isLocal, userId, localIsRegistered } = {}) {
  if (isLocal || !userId) return "omit";
  if (!localIsRegistered) return "omit";
  if (overlayStatus == null) return "omit";
  return rosterActionFromOverlay(overlayStatus, { localIsRegistered: true });
}

/** Popup Accepter / Refuser seulement écran calme, inscrit, pas d’autre dialog.
 * `sessionInPlay` : manche ou prépa en cours (y compris si l’écran local est Menu).
 */
export function canShowFriendRequestPopup({
  screenId,
  dialogOpen,
  localIsRegistered,
  sessionInPlay = false,
} = {}) {
  if (!localIsRegistered) return false;
  if (dialogOpen) return false;
  if (sessionInPlay) return false;
  if (screenId === FRIENDS_SCREEN_ID) return false;
  return isFriendNoticeCalmScreen(screenId);
}

/** Première demande incoming dont l’id n’a pas déjà eu une popup. */
export function nextUnseenFriendRequest(incoming, poppedIds) {
  const seen = poppedIds instanceof Set ? poppedIds : new Set(poppedIds || []);
  for (const row of incoming || []) {
    if (row?.id && !seen.has(row.id)) return row;
  }
  return null;
}

/**
 * Résultat de la popup demande d’ami.
 * true = Accepter, false = Refuser, autre (clic hors / Escape) = reporter.
 */
export function friendRequestPopupDecision(confirmResult) {
  if (confirmResult === true) return "accept";
  if (confirmResult === false) return "refuse";
  return "dismiss";
}

export function friendRequestNoticeCopy(row) {
  const name = row?.name || "Quelqu’un";
  const emoji = row?.emoji || "👤";
  return {
    title: FRIEND_LABEL.noticeTitle,
    message: `${name} veut t’ajouter`,
    icon: emoji,
    confirmLabel: FRIEND_LABEL.accept,
    cancelLabel: FRIEND_LABEL.refuse,
  };
}

export function friendsBadgeShouldShow(incomingCount) {
  return Number(incomingCount) > 0;
}

/** Confirmation locale seulement — l’autre n’est pas notifié. */
export function unfriendConfirmCopy(name) {
  const who = String(name || "").trim() || "ce joueur";
  return {
    title: FRIEND_LABEL.pageTitle,
    message: `Retirer ${who} de tes amis ?`,
    confirmLabel: FRIEND_LABEL.unfriend,
    cancelLabel: FRIEND_LABEL.unfriendCancel,
    icon: "⚠️",
  };
}
