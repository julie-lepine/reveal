/**
 * FEATURE-FRIENDS-02 — accepter une invitation puis hydrater le lobby (sans code).
 */
import { getCurrentScreen } from "./router.js";
import {
  getLobby,
  goToLobby,
  hasActiveLobby,
  leaveLobby,
  navigateAfterLobbyJoin,
  tryRecoverLobbyFromServer,
} from "./lobby.js";
import { LOBBY_INVITE_RPC_ERROR } from "../config/lobbyInvites.js";
import { getIncomingLobbyInvites } from "./lobbyInvitesState.js";
import {
  acceptLobbyInvite,
  declineLobbyInvite,
  fetchIncomingLobbyInvites,
} from "./supabaseLobbyInvites.js";

async function hydrateAfterLobbyInviteAccept() {
  let recovered = await tryRecoverLobbyFromServer();
  if (!recovered?.ok) {
    recovered = await tryRecoverLobbyFromServer();
  }
  if (!recovered?.ok && !hasActiveLobby() && !getLobby()?.code) {
    return { ok: false };
  }
  await navigateAfterLobbyJoin();
  const screen = getCurrentScreen();
  if ((screen === "friends" || screen === "home") && (hasActiveLobby() || getLobby()?.code)) {
    goToLobby();
  }
  return { ok: true };
}

export async function joinFromLobbyInvite(inviteId) {
  if (!inviteId) return { ok: false, skipped: true };
  const invite = getIncomingLobbyInvites().find((row) => row.id === inviteId);
  const currentLobbyId = getLobby()?.id || null;
  if (
    hasActiveLobby() &&
    currentLobbyId &&
    invite?.lobbyId &&
    invite.lobbyId !== currentLobbyId
  ) {
    return { ok: false, code: LOBBY_INVITE_RPC_ERROR.busy, invite };
  }
  try {
    const res = await acceptLobbyInvite(inviteId);
    if (res?.skipped) return { ok: false, skipped: true };
    if (!res?.ok || (res.result !== "joined" && res.result !== "already_in")) {
      return { ok: false, code: null };
    }
    const hydrated = await hydrateAfterLobbyInviteAccept();
    void fetchIncomingLobbyInvites();
    if (!hydrated.ok) return { ok: false, joinedUnhydrated: true };
    return { ok: true, result: res.result };
  } catch (err) {
    return { ok: false, code: err.code, error: err };
  }
}

export async function refuseLobbyInvite(inviteId) {
  if (!inviteId) return { ok: false, skipped: true };
  try {
    const res = await declineLobbyInvite(inviteId);
    if (res?.skipped) return { ok: false, skipped: true };
    await fetchIncomingLobbyInvites();
    return { ok: Boolean(res?.ok), result: res?.result };
  } catch (err) {
    return { ok: false, code: err.code, error: err };
  }
}

export async function leaveAndJoinFromLobbyInvite(inviteId) {
  if (!inviteId) return { ok: false, skipped: true };
  const left = await leaveLobby({ navigateAway: false });
  if (left?.cancelled) return { ok: false, cancelled: true };
  if (left && left.ok === false) {
    return { ok: false, error: left.error, code: left.code };
  }
  return joinFromLobbyInvite(inviteId);
}
