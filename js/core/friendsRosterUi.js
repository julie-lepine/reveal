/**
 * HTML roster ami (waiting room + liste Soirée). Pas de fetch.
 */
import { FRIEND_LABEL, FRIEND_ROSTER_ACTION } from "../config/friends.js";
import { peerFriendRosterKind, rosterLabelFromAction } from "./friendsLogic.js";
import { getLobbyFriendOverlayStatus } from "./friendsState.js";
import { escapeHtml } from "./ui.js";

export function friendRosterActionHtml(p, { localIsRegistered, lobbyId } = {}) {
  const status = lobbyId && p.userId ? getLobbyFriendOverlayStatus(lobbyId, p.userId) : null;
  const kind = peerFriendRosterKind(status, {
    isLocal: p.isLocal,
    userId: p.userId,
    localIsRegistered,
  });
  if (kind === "omit") return "";
  const label = rosterLabelFromAction(kind);
  if (kind === FRIEND_ROSTER_ACTION.hintGuest) {
    return `<p class="participant__friend-hint">${escapeHtml(FRIEND_LABEL.guestCard)}</p>`;
  }
  if (kind === FRIEND_ROSTER_ACTION.friend) {
    return `<span class="participant__friend-badge participant__friend-badge--${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
  }
  if (kind === FRIEND_ROSTER_ACTION.add) {
    return `<button type="button" class="participant__friend-btn" data-friend-add="${escapeHtml(p.userId)}" aria-label="${escapeHtml(label)} ${escapeHtml(p.name)}">${escapeHtml(label)}</button>`;
  }
  if (kind === FRIEND_ROSTER_ACTION.cancel) {
    return `<button type="button" class="participant__friend-btn participant__friend-btn--cancel" data-friend-cancel="${escapeHtml(p.userId)}" aria-label="${escapeHtml(label)} ${escapeHtml(p.name)}">${escapeHtml(label)}</button>`;
  }
  if (kind === FRIEND_ROSTER_ACTION.accept) {
    return `<button type="button" class="participant__friend-btn participant__friend-btn--accept" data-friend-accept="${escapeHtml(p.userId)}" aria-label="${escapeHtml(label)} ${escapeHtml(p.name)}">${escapeHtml(label)}</button>`;
  }
  return "";
}

export function lobbyFriendsHintHtml(localIsRegistered, participants) {
  if (localIsRegistered) return "";
  const hasOthers = (participants || []).some((p) => !p.isLocal && p.userId);
  if (!hasOthers) return "";
  return `<p class="hint lobby-friends-hint" data-lobby-friends-hint>${escapeHtml(FRIEND_LABEL.guestHint)}</p>`;
}
