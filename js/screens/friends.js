/**
 * FEATURE-FRIENDS-01 Palier 6–7 — page Amis (demandes + liste + unfriend).
 * FEATURE-FRIENDS-02 Palier 4 — Inviter / invitations de soirée.
 * FEATURE-FRIENDS-03 Palier 3 — Demandes envoyées / Annuler.
 * FEATURE-FRIENDS-04 Palier 3 — Vous venez de jouer avec.
 */
import {
  FRIEND_LABEL,
  FRIEND_OVERLAY,
  FRIENDS_SCREEN_ID,
} from "../config/friends.js";
import {
  LOBBY_INVITE_ACTION,
  LOBBY_INVITE_LABEL,
  friendInviteAction,
  lobbyInviteBusyCopy,
  lobbyInviteBusyDecision,
} from "../config/lobbyInvites.js";
import {
  RECENT_PEER_ACTION,
  RECENT_PEERS_LABEL,
} from "../config/recentPeers.js";
import { isLoggedIn } from "../core/auth.js";
import { createActionLock } from "../core/actionLock.js";
import { showAppAlert, showAppConfirm } from "../core/dialog.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import {
  getLobby,
  getLobbyParticipants,
  hasActiveLobby,
} from "../core/lobby.js";
import {
  getIncomingFriendRequests,
  getMyFriends,
  getOutgoingFriendRequests,
  onFriendsCacheUpdated,
  patchLobbyFriendOverlayStatus,
} from "../core/friendsState.js";
import {
  getIncomingLobbyInvites,
  isLobbyInvitePendingOut,
  onLobbyInvitesCacheUpdated,
} from "../core/lobbyInvitesState.js";
import {
  lobbyInviteAcceptPlan,
  lobbyInviteFailMessage,
} from "../core/lobbyInvitesLogic.js";
import {
  joinFromLobbyInvite,
  leaveAndJoinFromLobbyInvite,
  refuseLobbyInvite,
} from "../core/lobbyInviteJoin.js";
import { isSilentFriendRpcCode, unfriendConfirmCopy } from "../core/friendsLogic.js";
import {
  recentPeerRowAction,
} from "../core/recentPeersLogic.js";
import {
  getRecentLobbyPeers,
  onRecentPeersCacheUpdated,
} from "../core/recentPeersState.js";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  fetchIncomingFriendRequests,
  fetchMyFriends,
  fetchOutgoingFriendRequests,
  sendFriendRequest,
  unfriendUser,
} from "../core/supabaseFriends.js";
import {
  fetchIncomingLobbyInvites,
  fetchOutgoingLobbyInvites,
  sendLobbyInvite,
} from "../core/supabaseLobbyInvites.js";
import { fetchRecentLobbyPeers } from "../core/supabaseRecentPeers.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

function outgoingRowHtml(row) {
  return `
    <div class="friends-row" data-friend-to="${escapeHtml(row.toUserId)}">
      <span class="friends-row__avatar" aria-hidden="true">${escapeHtml(row.emoji || "👤")}</span>
      <span class="friends-row__name">${escapeHtml(row.name || "Joueur")}</span>
      <div class="friends-row__actions">
        <button type="button" class="btn btn-secondary btn--compact" data-friend-cancel="${escapeHtml(row.toUserId)}">${escapeHtml(FRIEND_LABEL.cancelRequest)}</button>
      </div>
    </div>`;
}

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

function friendInviteKind(row, { localIsRegistered, localInLobby, lobbyId, peerIds }) {
  return friendInviteAction({
    localIsRegistered,
    localInLobby,
    peerInSameLobby: peerIds.has(row.userId),
    pendingOut: isLobbyInvitePendingOut(lobbyId, row.userId),
  });
}

function friendInviteControlHtml(row, inviteCtx) {
  const kind = friendInviteKind(row, inviteCtx);
  if (kind === LOBBY_INVITE_ACTION.omit) return "";
  if (kind === LOBBY_INVITE_ACTION.alreadyIn) return "";
  if (kind === LOBBY_INVITE_ACTION.sent) {
    return `<button type="button" class="btn btn-secondary btn--compact" data-lobby-invite-sent="${escapeHtml(row.userId)}" disabled>${escapeHtml(LOBBY_INVITE_LABEL.sent)}</button>`;
  }
  return `<button type="button" class="btn btn-primary btn--compact" data-lobby-invite-send="${escapeHtml(row.userId)}">${escapeHtml(LOBBY_INVITE_LABEL.invite)}</button>`;
}

function recentPeerControlHtml(userId, action) {
  if (action === RECENT_PEER_ACTION.add) {
    return `<button type="button" class="btn btn-primary btn--compact" data-recent-peer-add="${escapeHtml(userId)}">${escapeHtml(FRIEND_LABEL.add)}</button>`;
  }
  if (action === RECENT_PEER_ACTION.cancel) {
    return `<button type="button" class="btn btn-secondary btn--compact" data-recent-peer-cancel="${escapeHtml(userId)}">${escapeHtml(FRIEND_LABEL.cancelRequest)}</button>`;
  }
  if (action === RECENT_PEER_ACTION.accept) {
    return `<button type="button" class="btn btn-primary btn--compact" data-recent-peer-accept="${escapeHtml(userId)}">${escapeHtml(FRIEND_LABEL.accept)}</button>`;
  }
  return "";
}

function recentPeerRowHtml(row, graph, { peerIds }) {
  const action = recentPeerRowAction(row.userId, graph, {
    localIsRegistered: true,
    currentlyInSameLobby: peerIds.has(row.userId),
  });
  if (action === RECENT_PEER_ACTION.omit) return "";
  return `
    <div class="friends-row" data-recent-peer="${escapeHtml(row.userId)}">
      <span class="friends-row__avatar" aria-hidden="true">${escapeHtml(row.emoji || "👤")}</span>
      <span class="friends-row__name">${escapeHtml(row.name || "Joueur")}</span>
      <div class="friends-row__actions">
        ${recentPeerControlHtml(row.userId, action)}
      </div>
    </div>`;
}

function friendRowHtml(row, inviteCtx) {
  const inEvening = friendInviteKind(row, inviteCtx) === LOBBY_INVITE_ACTION.alreadyIn;
  const status = inEvening
    ? `<span class="friends-row__status">${escapeHtml(LOBBY_INVITE_LABEL.alreadyIn)}</span>`
    : "";
  return `
    <div class="friends-row" data-friend-user="${escapeHtml(row.userId)}">
      <span class="friends-row__avatar" aria-hidden="true">${escapeHtml(row.emoji || "👤")}</span>
      <div class="friends-row__meta">
        <span class="friends-row__name">${escapeHtml(row.name || "Joueur")}</span>
        ${status}
      </div>
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
  const outgoing = getOutgoingFriendRequests();
  const friends = getMyFriends();
  const recentPeers = getRecentLobbyPeers();
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
  const outgoingBody = outgoing.length
    ? outgoing.map(outgoingRowHtml).join("")
    : `<p class="hint friends-empty__hint" data-friends-outgoing-empty>${escapeHtml(FRIEND_LABEL.outgoingEmpty)}</p>`;
  const recentGraph = { friends, incoming, outgoing };
  const recentRows = recentPeers
    .map((row) => recentPeerRowHtml(row, recentGraph, { peerIds }))
    .filter(Boolean);
  const recentBody = recentRows.length
    ? recentRows.join("")
    : `<p class="hint friends-empty__hint" data-recent-peers-empty>${escapeHtml(RECENT_PEERS_LABEL.empty)}</p>`;
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
    <section class="card settings-section" data-friends-outgoing>
      <h2 class="settings-section__title">${escapeHtml(FRIEND_LABEL.outgoingSection)}</h2>
      ${outgoingBody}
    </section>
    <section class="card settings-section" data-recent-peers>
      <h2 class="settings-section__title">${escapeHtml(RECENT_PEERS_LABEL.section)}</h2>
      ${recentBody}
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
  let unsubRecentPeersCache = () => {};
  let joiningLobby = false;

  function paint() {
    if (!mount.isMounted()) return;
    if (joiningLobby) return;
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
    app.querySelector("[data-friends-outgoing]")?.addEventListener("click", (e) => {
      const cancelBtn = e.target.closest("[data-friend-cancel]");
      if (cancelBtn) {
        void onCancelOutgoing(cancelBtn.getAttribute("data-friend-cancel"));
      }
    });
    app.querySelector("[data-recent-peers]")?.addEventListener("click", (e) => {
      const addBtn = e.target.closest("[data-recent-peer-add]");
      if (addBtn) {
        void onAddRecentPeer(addBtn.getAttribute("data-recent-peer-add"));
        return;
      }
      const acceptBtn = e.target.closest("[data-recent-peer-accept]");
      if (acceptBtn) {
        void onAccept(acceptBtn.getAttribute("data-recent-peer-accept"));
        return;
      }
      const cancelBtn = e.target.closest("[data-recent-peer-cancel]");
      if (cancelBtn) {
        void onCancelOutgoing(cancelBtn.getAttribute("data-recent-peer-cancel"));
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
      await Promise.all([
        fetchIncomingFriendRequests(),
        fetchMyFriends(),
        fetchRecentLobbyPeers(),
      ]);
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

  async function onCancelOutgoing(toUserId) {
    if (!toUserId || !isLoggedIn()) return;
    const run = await actionLock.run(async () => {
      try {
        return await cancelFriendRequest(toUserId);
      } catch (err) {
        return { ok: false, error: err };
      }
    });
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok || res?.skipped) {
      await Promise.all([fetchOutgoingFriendRequests(), fetchRecentLobbyPeers()]);
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    await showAppAlert(res?.error?.message || "Impossible d'annuler.", {
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
      await Promise.all([fetchMyFriends(), fetchRecentLobbyPeers()]);
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    await showAppAlert(res?.error?.message || "Impossible de retirer cet ami.", {
      title: FRIEND_LABEL.pageTitle,
      icon: "⚠️",
    });
  }

  async function onAddRecentPeer(toUserId) {
    if (!toUserId || !isLoggedIn()) return;
    const run = await actionLock.run(async () => {
      try {
        return await sendFriendRequest(toUserId);
      } catch (err) {
        return { ok: false, error: err };
      }
    });
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok) {
      await Promise.all([
        fetchOutgoingFriendRequests(),
        fetchMyFriends(),
        fetchRecentLobbyPeers(),
      ]);
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    if (res?.skipped || isSilentFriendRpcCode(res?.code)) return;
    await showAppAlert(res?.error?.message || "Impossible d'ajouter.", {
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
    const run = await actionLock.run(() => refuseLobbyInvite(inviteId));
    if (!mount.isMounted()) return;
    if (run.skipped) return;
    const res = run.value;
    if (res?.ok) {
      if (!mount.isMounted()) return;
      paint();
      return;
    }
    await showAppAlert(lobbyInviteFailMessage(res?.code), {
      title: LOBBY_INVITE_LABEL.noticeTitle,
      icon: "⚠️",
    });
  }

  async function onJoinInvite(inviteId) {
    if (!inviteId || !isLoggedIn()) return;
    const invite = getIncomingLobbyInvites().find((row) => row.id === inviteId);
    const plan = lobbyInviteAcceptPlan({
      localInLobby: hasActiveLobby(),
      localLobbyId: getLobby()?.id || null,
      inviteLobbyId: invite?.lobbyId || null,
    });
    if (plan === "busy") {
      const copy = lobbyInviteBusyCopy(invite);
      const accepted = await showAppConfirm(copy.message, {
        title: copy.title,
        confirmLabel: copy.confirmLabel,
        cancelLabel: copy.cancelLabel,
        icon: copy.icon,
        dismissResult: null,
      });
      if (!mount.isMounted()) return;
      const decision = lobbyInviteBusyDecision(accepted);
      if (decision === "stay_and_refuse") {
        await onRefuseInvite(inviteId);
        return;
      }
      if (decision !== "leave_and_join") return;
      joiningLobby = true;
      const runLeave = await actionLock.run(() => leaveAndJoinFromLobbyInvite(inviteId));
      if (runLeave.skipped) {
        joiningLobby = false;
        return;
      }
      const left = runLeave.value;
      if (left?.ok) return;
      joiningLobby = false;
      if (!mount.isMounted()) return;
      if (left?.cancelled) return;
      await showAppAlert(lobbyInviteFailMessage(left?.code), {
        title: LOBBY_INVITE_LABEL.busyTitle,
        icon: "⚠️",
      });
      return;
    }
    joiningLobby = true;
    const run = await actionLock.run(() => joinFromLobbyInvite(inviteId));
    if (run.skipped) {
      joiningLobby = false;
      return;
    }
    const res = run.value;
    if (res?.ok) return;
    joiningLobby = false;
    if (!mount.isMounted()) return;
    if (res?.skipped) return;
    if (res?.joinedUnhydrated) {
      await showAppAlert("Invitation acceptée. Retourne à l’accueil pour ouvrir la soirée.", {
        title: LOBBY_INVITE_LABEL.noticeTitle,
        icon: "🎉",
      });
      return;
    }
    await showAppAlert(lobbyInviteFailMessage(res?.code), {
      title: LOBBY_INVITE_LABEL.noticeTitle,
      icon: "⚠️",
    });
  }

  function onCacheUpdated() {
    if (!mount.isMounted()) return;
    if (joiningLobby) return;
    if (!isLoggedIn()) return;
    paint();
  }

  paint();
  unsubFriendsCache = onFriendsCacheUpdated(onCacheUpdated);
  unsubInvitesCache = onLobbyInvitesCacheUpdated(onCacheUpdated);
  unsubRecentPeersCache = onRecentPeersCacheUpdated(onCacheUpdated);
  if (isLoggedIn()) {
    void Promise.all([
      fetchIncomingFriendRequests(),
      fetchOutgoingFriendRequests(),
      fetchMyFriends(),
      fetchIncomingLobbyInvites(),
      fetchOutgoingLobbyInvites(),
      fetchRecentLobbyPeers(),
    ]).catch((e) => {
      console.warn("[FRIENDS] refresh", e?.message || e);
    });
  }

  return () => {
    mount.dispose();
    unsubFriendsCache();
    unsubInvitesCache();
    unsubRecentPeersCache();
  };
}

export { FRIENDS_SCREEN_ID };
