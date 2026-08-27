/**
 * FEATURE-FRIENDS-01 Palier 5 — popup incoming sur écran calme, sinon badge.
 * Jamais de message chat. Pendant une manche : pas de showAppConfirm.
 */
import { FRIEND_OVERLAY } from "../config/friends.js";
import { getCurrentScreen, onScreenChange } from "./router.js";
import { isAppDialogOpen, showAppConfirm } from "./dialog.js";
import { getState } from "./state.js";
import {
  canShowFriendRequestPopup,
  friendRequestNoticeCopy,
  friendRequestPopupDecision,
  friendsBadgeShouldShow,
  isRegisteredUser,
  nextUnseenFriendRequest,
} from "./friendsLogic.js";
import {
  getIncomingFriendRequestCount,
  getIncomingFriendRequests,
  onFriendsCacheUpdated,
  patchLobbyFriendOverlayStatus,
} from "./friendsState.js";
import { acceptFriendRequest, declineFriendRequest } from "./supabaseFriends.js";

const poppedIds = new Set();
let busy = false;
let started = false;

export function resetFriendRequestNoticeForTests() {
  poppedIds.clear();
  busy = false;
}

export function syncFriendsEntryBadges(root = typeof document !== "undefined" ? document : null) {
  if (!root?.querySelectorAll) return;
  const show = friendsBadgeShouldShow(getIncomingFriendRequestCount());
  root.querySelectorAll("[data-friends-badge]").forEach((el) => {
    el.hidden = !show;
    el.setAttribute("aria-hidden", show ? "false" : "true");
  });
}

function canPopupNow() {
  return canShowFriendRequestPopup({
    screenId: getCurrentScreen(),
    dialogOpen: isAppDialogOpen() || busy,
    localIsRegistered: isRegisteredUser(getState().user),
  });
}

async function presentIncoming(row) {
  const copy = friendRequestNoticeCopy(row);
  poppedIds.add(row.id);
  busy = true;
  try {
    const accepted = await showAppConfirm(copy.message, {
      title: copy.title,
      confirmLabel: copy.confirmLabel,
      cancelLabel: copy.cancelLabel,
      icon: copy.icon,
      dismissResult: null,
    });
    const fromUserId = row.fromUserId;
    const lobbyId = getState().lobby?.id || null;
    const decision = friendRequestPopupDecision(accepted);
    if (decision === "accept") {
      const res = await acceptFriendRequest(fromUserId);
      if (res?.ok && lobbyId) {
        patchLobbyFriendOverlayStatus(lobbyId, fromUserId, FRIEND_OVERLAY.friends);
      }
    } else if (decision === "refuse") {
      const res = await declineFriendRequest(fromUserId);
      if (res?.ok && lobbyId) {
        patchLobbyFriendOverlayStatus(lobbyId, fromUserId, FRIEND_OVERLAY.none);
      }
    }
  } catch {
    /* RPC déjà absente / réseau : catch-up Realtime rattrape */
  } finally {
    busy = false;
  }
}

export async function flushFriendRequestNotice() {
  if (!isRegisteredUser(getState().user)) {
    poppedIds.clear();
    syncFriendsEntryBadges();
    return;
  }
  syncFriendsEntryBadges();
  if (busy) return;
  if (!canPopupNow()) return;
  const next = nextUnseenFriendRequest(getIncomingFriendRequests(), poppedIds);
  if (!next) return;
  await presentIncoming(next);
  if (!busy) void flushFriendRequestNotice();
}

export function initFriendRequestNotice() {
  if (started) return;
  started = true;
  onFriendsCacheUpdated(() => {
    void flushFriendRequestNotice();
  });
  onScreenChange(() => {
    void flushFriendRequestNotice();
  });
  void flushFriendRequestNotice();
}
