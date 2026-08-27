/**
 * FEATURE-FRIENDS-01 Palier 6–7 — page Amis (demandes + liste + unfriend).
 * FEATURE-FRIENDS-02 Palier 4 — Inviter / invitations de soirée.
 * Découverte toujours via le lobby, pas de recherche.
 */
import {
  FRIEND_LABEL,
  FRIEND_OVERLAY,
  FRIENDS_SCREEN_ID,
} from "../config/friends.js";
import {
  LOBBY_INVITE_ACTION,
  LOBBY_INVITE_LABEL,
  LOBBY_INVITE_RPC_ERROR,
  friendInviteAction,
} from "../config/lobbyInvites.js";
import { isLoggedIn } from "../core/auth.js";
import { createActionLock } from "../core/actionLock.js";
import { showAppAlert, showAppConfirm } from "../core/dialog.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import {
  getLobby,
  getLobbyParticipants,
  hasActiveLobby,
  navigateAfterLobbyJoin,
  tryRecoverLobbyFromServer,
} from "../core/lobby.js";
import {
  getIncomingFriendRequests,
  getMyFriends,
  onFriendsCacheUpdated,
  patchLobbyFriendOverlayStatus,
} from "../core/friendsState.js";
import {
  getIncomingLobbyInvites,
  isLobbyInvitePendingOut,
  onLobbyInvitesCacheUpdated,
} from "../core/lobbyInvitesState.js";
import { lobbyInviteFailMessage } from "../core/lobbyInvitesLogic.js";
import { unfriendConfirmCopy } from "../core/friendsLogic.js";
import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchIncomingFriendRequests,
  fetchMyFriends,
  unfriendUser,
} from "../core/supabaseFriends.js";
import {
  acceptLobbyInvite,
  declineLobbyInvite,
  fetchIncomingLobbyInvites,
  fetchOutgoingLobbyInvites,
  sendLobbyInvite,
} from "../core/supabaseLobbyInvites.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

function incomingRowHtml(row) {
  return `
    <div class="friends-row" data-friend-from="${escapeHtml(row.fromUserId)}">
      <span class="friends-row__avatar" aria-hidden="true">${escapeHtml(row.emoji || "👤")}</span>
      <span class="friends-row__name">${escapeHtml(row.name || "Joueur")}</span>
      <div class="friends-row__actions">
        <button type="button" class="btn btn-primary btn--compact" data-friend-accept="${escapeHtml(row.fromUserId)}">${escapeHtml(FRIEND_LABEL.accept)}</button>
        <button type="button" class="btn btn-secondary btn--compact" data-friend-refuse="${escapeHtml(row.fromUserId)}">${escapeHtml(FRIEND_LABEL.refuse)}</button>
      </div>
    </div>`;
}

function incomingLobbyInviteRowHtml(row) {
  return `
    <div class="friends-row" data-lobby-invite="${escapeHtml(row.id)}">
      <span class="friends-row__avatar" aria-hidden="true">${escapeHtml(row.emoji || "👤")}</span>
      <span class="friends-row__name">${escapeHtml(row.name || "Joueur")}</span>
      <div class="friends-row__actions">
        <button type="button" class="btn btn-primary btn--compact" data-lobby-invite-join="${escapeHtml(row.id)}">${escapeHtml(LOBBY_INVITE_LABEL.join)}</button>
        <button type="button" class="btn btn-secondary btn--compact" data-lobby-invite-refuse="${escapeHtml(row.id)}">${escapeHtml(LOBBY_INVITE_LABEL.refuse)}</button>
      </div>
    </div>`;
}

function friendInviteControlHtml(row, { localIsRegistered, localInLobby, lobbyId, peerIds }) {
  const kind = friendInviteAction({
    localIsRegistered,
    localInLobby,
    peerInSameLobby: peerIds.has(row.userId),
    pendingOut: isLobbyInvitePendingOut(lobbyId, row.userId),
  });
  if (kind === LOBBY_INVITE_ACTION.omit) return "";
  if (kind === LOBBY_INVITE_ACTION.alreadyIn) {
    return `<span class="friends-row__badge">${escapeHtml(LOBBY_INVITE_LABEL.alreadyIn)}</span>`;
  }
  if (kind === LOBBY_INVITE_ACTION.sent) {
    return `<button type="button" class="btn btn-secondary btn--compact" data-lobby-invite-sent="${escapeHtml(row.userId)}" disabled>${escapeHtml(LOBBY_INVITE_LABEL.sent)}</button>`;
  }
  return `<button type="button" class="btn btn-primary btn--compact" data-lobby-invite-send="${escapeHtml(row.userId)}">${escapeHtml(LOBBY_INVITE_LABEL.invite)}</button>`;
}

function friendRowHtml(row, inviteCtx) {
  return `
    <div class="friends-row" data-friend-user="${escapeHtml(row.userId)}">
      <span class="friends-row__avatar" aria-hidden="true">${escapeHtml(row.emoji || "👤")}</span>
      <span class="friends-row__name">${escapeHtml(row.name || "Joueur")}</span>
      <div class="friends-row__actions">
        ${friendInviteControlHtml(row, inviteCtx)}
        <button type="button" class="btn btn-secondary btn--compact" data-friend-unfriend="${escapeHtml(row.userId)}">${escapeHtml(FRIEND_LABEL.unfriend)}</button>
      </div>
    </div>`;
}

function guestPanelHtml() {
  const cta = hasActiveLobby()
    ? ""
    : `<button type="button" class="btn btn-primary btn--spaced" data-nav="home">Créer un compte</button>`;
  return `
    <div class="card friends-empty" data-friends-guest>
      <p class="hint">${escapeHtml(FRIEND_LABEL.guestHint)}</p>
      ${cta}
    </div>`;
}

function listsHtml() {
  const lobbyInvites = getIncomingLobbyInvites();
  const incoming = getIncomingFriendRequests();
  const friends = getMyFriends();
  const localInLobby = hasActiveLobby();
  const lobbyId = getLobby()?.id || null;
  const peerIds = new Set(
    localInLobby
      ? getLobbyParticipants()
          .map((p) => p.userId)
          .filter(Boolean)
      : []
  );
  const inviteCtx = {
    localIsRegistered: true,
    localInLobby,
    lobbyId,
    peerIds,
  };
  const lobbyInvitesBody = lobbyInvites.length
    ? lobbyInvites.map(incomingLobbyInviteRowHtml).join("")
    : `<p class="hint friends-empty__hint" data-lobby-invites-empty>${escapeHtml(LOBBY_INVITE_LABEL.incomingEmpty)}</p>`;
  const incomingBody = incoming.length
    ? incoming.map(incomingRowHtml).join("")
    : `<p class="hint friends-empty__hint" data-friends-incoming-empty>${escapeHtml(FRIEND_LABEL.incomingEmpty)}</p>`;
  const friendsBody = friends.length
    ? friends.map((row) => friendRowHtml(row, inviteCtx)).join("")
    : `<p class="hint friends-empty__hint" data-friends-list-empty>${escapeHtml(FRIEND_LABEL.friendsEmpty)}</p>`;
  const noLobbyHint = localInLobby
    ? ""
    : `<p class="hint friends-empty__hint" data-lobby-invite-no-lobby>${escapeHtml(LOBBY_INVITE_LABEL.noLobbyHint)}</p>`;
  return `
    <section class="card settings-section" data-lobby-invites-incoming>
      <h2 class="settings-section__title">${escapeHtml(LOBBY_INVITE_LABEL.incomingSection)}</h2>
      ${lobbyInvitesBody}
    </section>
    <section class="card settings-section" data-friends-incoming>
      <h2 class="settings-section__title">${escapeHtml(FRIEND_LABEL.incomingSection)}</h2>
      ${incomingBody}
    </section>
    <section class="card settings-section" data-friends-list>
      <h2 class="settings-section__title">${escapeHtml(FRIEND_LABEL.friendsSection)}</h2>
      ${noLobbyHint}
      ${friendsBody}
    </section>`;
}

export function mountFriends(app) {
  const mount = createMountGuard();
  const actionLock = createActionLock();
  let unsubFriendsCache = () => {};
  let unsubInvitesCache = () => {};

  function paint() {
    if (!mount.isMounted()) return;
    const registered = isLoggedIn();
    app.innerHTML = pageShell({
      back: true,
      backTarget: "back",
      scroll: true,
      content: `
        <p class="label-upper label-upper--gold">${escapeHtml(FRIEND_LABEL.pageTitle)}</p>
        <h1 class="page-title">${escapeHtml(FRIEND_LABEL.pageTitle)}</h1>
        ${registered ? listsHtml() : guestPanelHtml()}
      `,
    });
    bindNav(app);
    if (!registered) return;
    app.querySelector("[data-lobby-invites-incoming]")?.addEventListener("click", (e) => {
      const joinBtn = e.target.closest("[data-lobby-invite-join]");
      if (joinBtn) {
        void onJoinInvite(joinBtn.getAttribute("data-lobby-invite-join"));
        return;
      }
      const refuseBtn = e.target.closest("[data-lobby-invite-refuse]");
      if (refuseBtn) {
        void onRefuseInvite(refuseBtn.getAttribute("data-lobby-invite-refuse"));
      }
    });
    app.querySelector("[data-friends-incoming]")?.addEventListener("click", (e) => {
      const acceptBtn = e.target.closest("[data-friend-accept]");
      if (acceptBtn) {
        void onAccept(acceptBtn.getAttribute("data-friend-accept"));
        return;
      }
      const refuseBtn = e.target.closest("[data-friend-refuse]");
      if (refuseBtn) {
        void onRefuse(refuseBtn.getAttribute("data-friend-refuse"));
      }
    });
    app.querySelector("[data-friends-list]")?.addEventListener("click", (e) => {
      const inviteBtn = e.target.closest("[data-lobby-invite-send]");
      if (inviteBtn) {
        void onInvite(inviteBtn.getAttribute("data-lobby-invite-send"));
        return;
      }
      const unfriendBtn = e.target.closest("[data-friend-unfriend]");
      if (!unfriendBtn) return;
      const userId = unfriendBtn.getAttribute("data-friend-unfriend");
      const friend = getMyFriends().find((row) => row.userId === userId);
      void onUnfriend(userId, friend?.name);
    });
  }

  async function onAccept(fromUserId) {
    if (!fromUserId || !isLoggedIn()) return;
    const run = await actionLock.run(async () => {
      try {
        return await acceptFriendRequest(fromUserId);
      } catch (err) {
        return { ok: false, error: err };
      }
    });
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok) {
      const lobbyId = getLobby()?.id;
      if (lobbyId) {
        patchLobbyFriendOverlayStatus(lobbyId, fromUserId, FRIEND_OVERLAY.friends);
      }
      await Promise.all([fetchIncomingFriendRequests(), fetchMyFriends()]);
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    await showAppAlert(res?.error?.message || "Impossible d'accepter.", {
      title: FRIEND_LABEL.pageTitle,
      icon: "⚠️",
    });
  }

  async function onRefuse(fromUserId) {
    if (!fromUserId || !isLoggedIn()) return;
    const run = await actionLock.run(async () => {
      try {
        return await declineFriendRequest(fromUserId);
      } catch (err) {
        return { ok: false, error: err };
      }
    });
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok) {
      const lobbyId = getLobby()?.id;
      if (lobbyId) {
        patchLobbyFriendOverlayStatus(lobbyId, fromUserId, FRIEND_OVERLAY.none);
      }
      await fetchIncomingFriendRequests();
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    await showAppAlert(res?.error?.message || "Impossible de refuser.", {
      title: FRIEND_LABEL.pageTitle,
      icon: "⚠️",
    });
  }

  async function onUnfriend(otherUserId, name) {
    if (!otherUserId || !isLoggedIn()) return;
    const copy = unfriendConfirmCopy(name);
    const ok = await showAppConfirm(copy.message, {
      title: copy.title,
      confirmLabel: copy.confirmLabel,
      cancelLabel: copy.cancelLabel,
      icon: copy.icon,
    });
    if (!ok || !mount.isMounted()) return;
    const run = await actionLock.run(async () => {
      try {
        return await unfriendUser(otherUserId);
      } catch (err) {
        return { ok: false, error: err };
      }
    });
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok) {
      const lobbyId = getLobby()?.id;
      if (lobbyId) {
        patchLobbyFriendOverlayStatus(lobbyId, otherUserId, FRIEND_OVERLAY.none);
      }
      await fetchMyFriends();
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    await showAppAlert(res?.error?.message || "Impossible de retirer cet ami.", {
      title: FRIEND_LABEL.pageTitle,
      icon: "⚠️",
    });
  }

  async function onInvite(toUserId) {
    if (!toUserId || !isLoggedIn() || !hasActiveLobby()) return;
    const run = await actionLock.run(async () => {
      try {
        return await sendLobbyInvite(toUserId);
      } catch (err) {
        return { ok: false, error: err };
      }
    });
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok) {
      await fetchOutgoingLobbyInvites();
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    await showAppAlert(lobbyInviteFailMessage(res?.error?.code), {
      title: LOBBY_INVITE_LABEL.noticeTitle,
      icon: "⚠️",
    });
  }

  async function onRefuseInvite(inviteId) {
    if (!inviteId || !isLoggedIn()) return;
    const run = await actionLock.run(async () => {
      try {
        return await declineLobbyInvite(inviteId);
      } catch (err) {
        return { ok: false, error: err };
      }
    });
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok) {
      await fetchIncomingLobbyInvites();
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    await showAppAlert(lobbyInviteFailMessage(res?.error?.code), {
      title: LOBBY_INVITE_LABEL.noticeTitle,
      icon: "⚠️",
    });
  }

  async function onJoinInvite(inviteId) {
    if (!inviteId || !isLoggedIn()) return;
    const invite = getIncomingLobbyInvites().find((row) => row.id === inviteId);
    const currentLobbyId = getLobby()?.id || null;
    if (
      hasActiveLobby() &&
      currentLobbyId &&
      invite?.lobbyId &&
      invite.lobbyId !== currentLobbyId
    ) {
      await showAppAlert(lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.busy), {
        title: LOBBY_INVITE_LABEL.busyTitle,
        icon: "🎉",
      });
      return;
    }
    const run = await actionLock.run(async () => {
      try {
        return await acceptLobbyInvite(inviteId);
      } catch (err) {
        return { ok: false, error: err };
      }
    });
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok && (res.result === "joined" || res.result === "already_in")) {
      await fetchIncomingLobbyInvites();
      if (!mount.isMounted()) return;
      const recovered = await tryRecoverLobbyFromServer();
      if (!mount.isMounted()) return;
      if (recovered?.ok) {
        await navigateAfterLobbyJoin();
        return;
      }
      paint();
      return;
    }
    await fetchIncomingLobbyInvites();
    if (!mount.isMounted()) return;
    paint();
    await showAppAlert(lobbyInviteFailMessage(res?.error?.code), {
      title: LOBBY_INVITE_LABEL.noticeTitle,
      icon: "⚠️",
    });
  }

  function onCacheUpdated() {
    if (!mount.isMounted()) return;
    if (!isLoggedIn()) return;
    paint();
  }

  paint();
  unsubFriendsCache = onFriendsCacheUpdated(onCacheUpdated);
  unsubInvitesCache = onLobbyInvitesCacheUpdated(onCacheUpdated);
  if (isLoggedIn()) {
    void Promise.all([
      fetchIncomingFriendRequests(),
      fetchMyFriends(),
      fetchIncomingLobbyInvites(),
      fetchOutgoingLobbyInvites(),
    ]);
  }

  return () => {
    mount.dispose();
    unsubFriendsCache();
    unsubInvitesCache();
  };
}

export { FRIENDS_SCREEN_ID };
