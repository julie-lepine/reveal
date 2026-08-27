/**
 * FEATURE-FRIENDS-02 Palier 6 — accepter une invitation puis hydrater le lobby (sans code).
 * Membership via RPC accept ; hydrate par lobby_id. Plein / fermé / gone : pas d’hydrate.
 */
import { saveStatePatch } from "./state.js";
import {
  getLobby,
  goToLobby,
  hasActiveLobby,
  isLobbyEveningStarted,
  leaveLobby,
  navigateAfterLobbyJoin,
  tryRecoverLobbyFromServer,
} from "./lobby.js";
import { refreshLobbyFromSupabase } from "./supabaseLobby.js";
import { LOBBY_INVITE_RPC_ERROR } from "../config/lobbyInvites.js";
import {
  lobbyInviteAcceptPlan,
  parseLobbyInviteRpcError,
} from "./lobbyInvitesLogic.js";
import { getIncomingLobbyInvites } from "./lobbyInvitesState.js";
import {
  acceptLobbyInvite,
  declineLobbyInvite,
  fetchIncomingLobbyInvites,
} from "./supabaseLobbyInvites.js";
import { resetHostNoticeOnLobbySwitch } from "./hostNotice.js";

async function hydrateAfterLobbyInviteAccept(lobbyId) {
  if (lobbyId) {
    const prev = getLobby() || {};
    const sameLobby = Boolean(lobbyId && prev.id === lobbyId);
    saveStatePatch({
      inLobby: true,
      lobby: sameLobby
        ? { ...prev, id: lobbyId }
        : { id: lobbyId, code: "", participants: [] },
    });
    await refreshLobbyFromSupabase({ withMessages: true });
  }
  if (!getLobby()?.code) {
    const recovered = await tryRecoverLobbyFromServer();
    if (!recovered?.ok && !getLobby()?.code) return { ok: false };
  }
  saveStatePatch({ inLobby: true });
  goToLobby();
  void tryRecoverLobbyFromServer().then((recovered) => {
    if (!recovered?.ok) return;
    if (isLobbyEveningStarted()) void navigateAfterLobbyJoin();
  });
  return { ok: true };
}

export async function joinFromLobbyInvite(inviteId, { skipLocalBusy = false } = {}) {
  if (!inviteId) return { ok: false, skipped: true };
  const invite = getIncomingLobbyInvites().find((row) => row.id === inviteId);
  const plan = lobbyInviteAcceptPlan({
    localInLobby: hasActiveLobby(),
    localLobbyId: getLobby()?.id || null,
    inviteLobbyId: invite?.lobbyId || null,
  });
  if (!skipLocalBusy && plan === "busy") {
    return { ok: false, code: LOBBY_INVITE_RPC_ERROR.busy, invite };
  }
  try {
    const res = await acceptLobbyInvite(inviteId);
    if (res?.skipped) return { ok: false, skipped: true };
    if (!res?.ok || (res.result !== "joined" && res.result !== "already_in")) {
      void fetchIncomingLobbyInvites();
      return {
        ok: false,
        code: parseLobbyInviteRpcError({ message: res?.result }),
      };
    }
    const hydrated = await hydrateAfterLobbyInviteAccept(res.lobbyId || invite?.lobbyId);
    void fetchIncomingLobbyInvites();
    if (!hydrated.ok) return { ok: false, joinedUnhydrated: true };
    return { ok: true, result: res.result };
  } catch (err) {
    void fetchIncomingLobbyInvites();
    return {
      ok: false,
      code: err.code || parseLobbyInviteRpcError(err),
      error: err,
    };
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
  resetHostNoticeOnLobbySwitch();
  const left = await leaveLobby({ navigateAway: false, skipConfirm: true });
  if (left?.cancelled) return { ok: false, cancelled: true };
  if (left && left.ok === false) {
    return { ok: false, error: left.error, code: left.code };
  }
  return joinFromLobbyInvite(inviteId, { skipLocalBusy: true });
}
