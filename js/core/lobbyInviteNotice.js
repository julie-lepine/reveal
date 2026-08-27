/**
 * FEATURE-FRIENDS-02 Palier 5 — popup invitation de soirée sur écran calme, sinon badge.
 * Jamais de message chat. Pendant une manche : pas de showAppConfirm.
 */
import {
  lobbyInviteBusyCopy,
  lobbyInviteBusyDecision,
  lobbyInviteNoticeCopy,
  lobbyInvitePopupDecision,
} from "../config/lobbyInvites.js";
import { getCurrentScreen, onScreenChange } from "./router.js";
import { isAppDialogOpen, showAppAlert, showAppConfirm } from "./dialog.js";
import { getState } from "./state.js";
import { canShowFriendRequestPopup, isRegisteredUser } from "./friendsLogic.js";
import { getLobby, hasActiveLobby } from "./lobby.js";
import {
  getIncomingLobbyInvites,
  onLobbyInvitesCacheUpdated,
} from "./lobbyInvitesState.js";
import { lobbyInviteFailMessage, nextUnseenLobbyInvite } from "./lobbyInvitesLogic.js";
import {
  joinFromLobbyInvite,
  leaveAndJoinFromLobbyInvite,
  refuseLobbyInvite,
} from "./lobbyInviteJoin.js";
import { syncFriendsEntryBadges } from "./friendRequestNotice.js";
import {
  getCachedGameSession,
  getEffectiveSessionScreen,
  isOnGameSetupScreen,
  isSessionInProgressPlay,
} from "./gameSync.js";

const poppedIds = new Set();
let busy = false;
let started = false;

export function resetLobbyInviteNoticeForTests() {
  poppedIds.clear();
  busy = false;
}

function sessionBlocksInvitePopup() {
  const screen = getEffectiveSessionScreen(getCachedGameSession());
  if (!screen) return false;
  return isOnGameSetupScreen(screen) || isSessionInProgressPlay(screen);
}

function canPopupNow() {
  return canShowFriendRequestPopup({
    screenId: getCurrentScreen(),
    dialogOpen: isAppDialogOpen() || busy,
    localIsRegistered: isRegisteredUser(getState().user),
    sessionInPlay: sessionBlocksInvitePopup(),
  });
}

async function presentIncoming(row) {
  poppedIds.add(row.id);
  busy = true;
  const currentLobbyId = getLobby()?.id || null;
  const alreadyElsewhere =
    hasActiveLobby() && currentLobbyId && row.lobbyId && row.lobbyId !== currentLobbyId;
  const copy = alreadyElsewhere ? lobbyInviteBusyCopy(row) : lobbyInviteNoticeCopy(row);
  try {
    const accepted = await showAppConfirm(copy.message, {
      title: copy.title,
      confirmLabel: copy.confirmLabel,
      cancelLabel: copy.cancelLabel,
      icon: copy.icon,
      dismissResult: null,
    });
    const decision = alreadyElsewhere
      ? lobbyInviteBusyDecision(accepted)
      : lobbyInvitePopupDecision(accepted);
    let res = { ok: true };
    if (decision === "join") {
      res = await joinFromLobbyInvite(row.id);
    } else if (decision === "leave_and_join") {
      res = await leaveAndJoinFromLobbyInvite(row.id);
    } else if (decision === "refuse" || decision === "stay_and_refuse") {
      res = await refuseLobbyInvite(row.id);
    }
    if (res?.cancelled || res?.skipped) return;
    if (res && res.ok === false && !res.joinedUnhydrated) {
      await showAppAlert(lobbyInviteFailMessage(res.code), {
        title: copy.title,
        icon: "⚠️",
      });
    }
  } catch {
    /* RPC / réseau : catch-up Realtime rattrape */
  } finally {
    busy = false;
  }
}

export async function flushLobbyInviteNotice() {
  if (!isRegisteredUser(getState().user)) {
    poppedIds.clear();
    syncFriendsEntryBadges();
    return;
  }
  syncFriendsEntryBadges();
  if (busy) return;
  if (!canPopupNow()) return;
  const next = nextUnseenLobbyInvite(getIncomingLobbyInvites(), poppedIds);
  if (!next) return;
  await presentIncoming(next);
  if (!busy) void flushLobbyInviteNotice();
}

export function initLobbyInviteNotice() {
  if (started) return;
  started = true;
  onLobbyInvitesCacheUpdated(() => {
    void flushLobbyInviteNotice();
  });
  onScreenChange(() => {
    void flushLobbyInviteNotice();
  });
  void flushLobbyInviteNotice();
}
