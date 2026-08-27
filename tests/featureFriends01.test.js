/**
 * FEATURE-FRIENDS-01 Palier 2 — couche client sans UI.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIEND_LABEL,
  FRIEND_OVERLAY,
  FRIEND_ROSTER_ACTION,
  FRIEND_RPC,
  FRIEND_RPC_ERROR,
  rosterActionFromOverlay,
} from "../js/config/friends.js";
import {
  isRegisteredUser,
  isSilentFriendRpcCode,
  overlayEntriesToMap,
  overlayStatusAfterSilentFailure,
  parseFriendRpcError,
  rosterActionForPeer,
  rosterLabelFromAction,
  normalizeFriendRow,
  normalizeIncomingRequestRow,
} from "../js/core/friendsLogic.js";
import {
  clearFriendsCache,
  getIncomingFriendRequestCount,
  getIncomingFriendRequests,
  getLobbyFriendOverlayStatus,
  getMyFriends,
  markOverlayPendingOut,
  patchLobbyFriendOverlayStatus,
  setIncomingFriendRequests,
  setLobbyFriendOverlay,
  setMyFriends,
} from "../js/core/friendsState.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-01 Palier 2 — client", () => {
  beforeEach(() => {
    clearFriendsCache();
  });

  it("supabaseFriends : RPC du contrat, pas de chat lobby, pas d’écran", () => {
    const src = read("js/core/supabaseFriends.js");
    for (const name of Object.values(FRIEND_RPC)) {
      assert.match(src, new RegExp(`FRIEND_RPC\\.\\w+|${name}`));
    }
    assert.match(src, /p_to/);
    assert.match(src, /p_from/);
    assert.match(src, /p_other/);
    assert.match(src, /p_lobby_id/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /innerHTML|document\./);
    assert.match(src, /isRegisteredUser/);
    assert.match(src, /isSilentFriendRpcCode/);
  });

  it("friendsState n’est pas persisté dans state.js / localStorage", () => {
    const state = read("js/core/state.js");
    assert.doesNotMatch(state, /friendsState|friend_requests|setMyFriends/);
    const fs = read("js/core/friendsState.js");
    assert.doesNotMatch(fs, /localStorage/);
    assert.doesNotMatch(fs, /scheduleSave/);
  });

  it("invité ne peut pas appeler le graphe", () => {
    assert.equal(isRegisteredUser({ loggedIn: true, isGuest: false }), true);
    assert.equal(isRegisteredUser({ loggedIn: false, isGuest: true }), false);
    assert.equal(isRegisteredUser({ loggedIn: true, isGuest: true }), false);
    assert.equal(isRegisteredUser(null), false);
  });

  it("overlay JSON → map ; self omis déjà côté SQL", () => {
    const map = overlayEntriesToMap([
      { user_id: "b", status: "none" },
      { user_id: "c", status: "pending_out" },
      { user_id: "bad", status: "declined" },
      { status: "friends" },
    ]);
    assert.equal(map.b, FRIEND_OVERLAY.none);
    assert.equal(map.c, FRIEND_OVERLAY.pendingOut);
    assert.equal(map.bad, undefined);
  });

  it("mapping overlay → libellés roster", () => {
    assert.equal(
      rosterActionForPeer(FRIEND_OVERLAY.none, true),
      FRIEND_ROSTER_ACTION.add
    );
    assert.equal(rosterLabelFromAction(FRIEND_ROSTER_ACTION.add), FRIEND_LABEL.add);
    assert.equal(rosterLabelFromAction(FRIEND_ROSTER_ACTION.hintGuest), FRIEND_LABEL.guestCard);
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.pendingOut, { localIsRegistered: true }),
      FRIEND_ROSTER_ACTION.sent
    );
    assert.equal(rosterLabelFromAction(FRIEND_ROSTER_ACTION.sent), FRIEND_LABEL.sent);
    assert.equal(
      rosterActionForPeer(FRIEND_OVERLAY.pendingIn, true),
      FRIEND_ROSTER_ACTION.accept
    );
    assert.equal(
      rosterActionForPeer(FRIEND_OVERLAY.friends, true),
      FRIEND_ROSTER_ACTION.friend
    );
    assert.equal(
      rosterActionForPeer(FRIEND_OVERLAY.guest, true),
      FRIEND_ROSTER_ACTION.hintGuest
    );
    assert.equal(
      rosterActionForPeer(FRIEND_OVERLAY.none, false),
      FRIEND_ROSTER_ACTION.hintGuest
    );
  });

  it("refus / cooldown : parse silencieux, overlay redevient none", () => {
    assert.equal(
      parseFriendRpcError({ message: "friends_cooldown" }),
      FRIEND_RPC_ERROR.cooldown
    );
    assert.equal(isSilentFriendRpcCode(FRIEND_RPC_ERROR.cooldown), true);
    assert.equal(isSilentFriendRpcCode(FRIEND_RPC_ERROR.guest), false);
    assert.equal(overlayStatusAfterSilentFailure(FRIEND_OVERLAY.none), FRIEND_OVERLAY.none);
    assert.equal(overlayStatusAfterSilentFailure(null), FRIEND_OVERLAY.none);
  });

  it("cache overlay + optimistic pending_out + rollback", () => {
    setLobbyFriendOverlay("L1", { b: FRIEND_OVERLAY.none });
    assert.equal(getLobbyFriendOverlayStatus("L1", "b"), FRIEND_OVERLAY.none);
    assert.equal(getLobbyFriendOverlayStatus("L2", "b"), null);
    const prev = markOverlayPendingOut("L1", "b");
    assert.equal(prev, FRIEND_OVERLAY.none);
    assert.equal(getLobbyFriendOverlayStatus("L1", "b"), FRIEND_OVERLAY.pendingOut);
    patchLobbyFriendOverlayStatus("L1", "b", overlayStatusAfterSilentFailure(prev));
    assert.equal(getLobbyFriendOverlayStatus("L1", "b"), FRIEND_OVERLAY.none);
  });

  it("listes amis / incoming normalisées, pas de snapshot figé côté SQL (profiles live)", () => {
    setMyFriends([{ user_id: "x", display_name: "Léa", emoji: "🦊" }]);
    assert.deepEqual(getMyFriends(), [{ userId: "x", name: "Léa", emoji: "🦊" }]);
    setIncomingFriendRequests([
      { id: "r1", from_user_id: "y", display_name: "Max", emoji: "🎲", created_at: "t" },
    ]);
    assert.equal(getIncomingFriendRequestCount(), 1);
    assert.equal(getIncomingFriendRequests()[0].fromUserId, "y");
    assert.equal(normalizeFriendRow({ user_id: "z" }).name, "Joueur");
    assert.equal(normalizeIncomingRequestRow({ id: "1" }), null);
  });

  it("page Amis et Settings encore hors palier 2", () => {
    const settings = read("js/screens/settings.js");
    const home = read("js/screens/home.js");
    const main = read("js/main.js");
    assert.doesNotMatch(settings, /FRIENDS_SCREEN_ID|fetchMyFriends/);
    assert.doesNotMatch(home, /fetchMyFriends/);
    assert.doesNotMatch(main, /registerScreen\("friends"/);
  });
});
