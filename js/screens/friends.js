/**
 * FEATURE-FRIENDS-01 Palier 6 — page Amis (demandes + liste).
 * Unfriend = palier 7. Découverte toujours via le lobby, pas de recherche.
 */
import {
  FRIEND_LABEL,
  FRIEND_OVERLAY,
  FRIENDS_SCREEN_ID,
} from "../config/friends.js";
import { isLoggedIn } from "../core/auth.js";
import { createActionLock } from "../core/actionLock.js";
import { showAppAlert } from "../core/dialog.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { getLobby, hasActiveLobby } from "../core/lobby.js";
import {
  getIncomingFriendRequests,
  getMyFriends,
  onFriendsCacheUpdated,
  patchLobbyFriendOverlayStatus,
} from "../core/friendsState.js";
import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchIncomingFriendRequests,
  fetchMyFriends,
} from "../core/supabaseFriends.js";
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

function friendRowHtml(row) {
  return `
    <div class="friends-row">
      <span class="friends-row__avatar" aria-hidden="true">${escapeHtml(row.emoji || "👤")}</span>
      <span class="friends-row__name">${escapeHtml(row.name || "Joueur")}</span>
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
  const incoming = getIncomingFriendRequests();
  const friends = getMyFriends();
  const incomingBody = incoming.length
    ? incoming.map(incomingRowHtml).join("")
    : `<p class="hint friends-empty__hint" data-friends-incoming-empty>${escapeHtml(FRIEND_LABEL.incomingEmpty)}</p>`;
  const friendsBody = friends.length
    ? friends.map(friendRowHtml).join("")
    : `<p class="hint friends-empty__hint" data-friends-list-empty>${escapeHtml(FRIEND_LABEL.friendsEmpty)}</p>`;
  return `
    <section class="card settings-section" data-friends-incoming>
      <h2 class="settings-section__title">${escapeHtml(FRIEND_LABEL.incomingSection)}</h2>
      ${incomingBody}
    </section>
    <section class="card settings-section" data-friends-list>
      <h2 class="settings-section__title">${escapeHtml(FRIEND_LABEL.friendsSection)}</h2>
      ${friendsBody}
    </section>`;
}

export function mountFriends(app) {
  const mount = createMountGuard();
  const actionLock = createActionLock();
  let unsubCache = () => {};

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

  paint();
  unsubCache = onFriendsCacheUpdated(() => {
    if (!mount.isMounted()) return;
    if (!isLoggedIn()) return;
    paint();
  });
  if (isLoggedIn()) {
    void Promise.all([fetchIncomingFriendRequests(), fetchMyFriends()]);
  }

  return () => {
    mount.dispose();
    unsubCache();
  };
}

export { FRIENDS_SCREEN_ID };
