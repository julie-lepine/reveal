/**
 * Envoi / acceptation ami depuis un roster lobby (salle d’attente ou Menu Soirée).
 */
import { FRIEND_OVERLAY } from "../config/friends.js";
import { getState } from "./state.js";
import { isRegisteredUser, isSilentFriendRpcCode, overlayStatusAfterSilentFailure } from "./friendsLogic.js";
import {
  markOverlayPendingOut,
  patchLobbyFriendOverlayStatus,
} from "./friendsState.js";
import { acceptFriendRequest, sendFriendRequest } from "./supabaseFriends.js";

export async function sendLobbyFriendRequest(userId, lobbyId) {
  if (!userId || !lobbyId || !isRegisteredUser(getState().user)) {
    return { ok: false, skipped: true };
  }
  const prev = markOverlayPendingOut(lobbyId, userId);
  try {
    const res = await sendFriendRequest(userId);
    if (res?.ok && res.result === "friends") {
      patchLobbyFriendOverlayStatus(lobbyId, userId, FRIEND_OVERLAY.friends);
      return res;
    }
    if (res?.ok) return res;
    const code = res?.code || res?.error?.code;
    patchLobbyFriendOverlayStatus(lobbyId, userId, overlayStatusAfterSilentFailure(prev));
    return { ...res, silent: isSilentFriendRpcCode(code) || Boolean(res?.skipped) };
  } catch (err) {
    const code = err?.code;
    patchLobbyFriendOverlayStatus(lobbyId, userId, overlayStatusAfterSilentFailure(prev));
    return {
      ok: false,
      error: err,
      silent: isSilentFriendRpcCode(code),
    };
  }
}

export async function acceptLobbyFriendRequest(userId, lobbyId) {
  if (!userId || !isRegisteredUser(getState().user)) return { ok: false, skipped: true };
  try {
    const res = await acceptFriendRequest(userId);
    if (res?.ok && lobbyId) {
      patchLobbyFriendOverlayStatus(lobbyId, userId, FRIEND_OVERLAY.friends);
    }
    return res;
  } catch (err) {
    return { ok: false, error: err };
  }
}
