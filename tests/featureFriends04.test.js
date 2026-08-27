/**
 * FEATURE-FRIENDS-01 Palier 4 — roster waiting room (pas de chat ami).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIEND_LABEL,
  FRIEND_OVERLAY,
  FRIEND_ROSTER_ACTION,
} from "../js/config/friends.js";
import { peerFriendRosterKind } from "../js/core/friendsLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-01 Palier 4 — roster lobby", () => {
  it("peerFriendRosterKind : soi / invité local / overlay null → omit", () => {
    const peer = { isLocal: false, userId: "u2", localIsRegistered: true };
    assert.equal(peerFriendRosterKind(FRIEND_OVERLAY.none, { ...peer, isLocal: true }), "omit");
    assert.equal(peerFriendRosterKind(FRIEND_OVERLAY.none, { ...peer, userId: "" }), "omit");
    assert.equal(
      peerFriendRosterKind(FRIEND_OVERLAY.none, { ...peer, localIsRegistered: false }),
      "omit"
    );
    assert.equal(peerFriendRosterKind(null, peer), "omit");
  });

  it("inscrit + overlay : + Ami / Annuler / Accepter / Ami / Pas de compte", () => {
    const peer = { isLocal: false, userId: "u2", localIsRegistered: true };
    assert.equal(peerFriendRosterKind(FRIEND_OVERLAY.none, peer), FRIEND_ROSTER_ACTION.add);
    assert.equal(peerFriendRosterKind(FRIEND_OVERLAY.pendingOut, peer), FRIEND_ROSTER_ACTION.cancel);
    assert.equal(peerFriendRosterKind(FRIEND_OVERLAY.pendingIn, peer), FRIEND_ROSTER_ACTION.accept);
    assert.equal(peerFriendRosterKind(FRIEND_OVERLAY.friends, peer), FRIEND_ROSTER_ACTION.friend);
    assert.equal(peerFriendRosterKind(FRIEND_OVERLAY.guest, peer), FRIEND_ROSTER_ACTION.hintGuest);
    assert.equal(FRIEND_LABEL.add, "+ Ami");
    assert.equal(FRIEND_LABEL.cancelRequest, "Annuler");
    assert.equal(FRIEND_LABEL.accept, "Accepter");
    assert.equal(FRIEND_LABEL.friend, "Ami");
    assert.equal(FRIEND_LABEL.guestCard, "Pas de compte");
    assert.equal(FRIEND_LABEL.guestHint, "Crée un compte pour ajouter des amis");
  });

  it("lobby.js : boutons roster, overlay, pas de message chat ami", () => {
    const lobby = read("js/screens/lobby.js");
    assert.match(lobby, /data-friend-add/);
    assert.match(lobby, /data-friend-accept/);
    assert.match(lobby, /data-friend-cancel/);
    assert.match(lobby, /data-lobby-friends-hint/);
    assert.match(lobby, /sendLobbyFriendRequest/);
    assert.match(lobby, /acceptLobbyFriendRequest/);
    assert.match(lobby, /cancelLobbyFriendRequest/);
    assert.match(lobby, /fetchLobbyFriendOverlay/);
    assert.match(lobby, /onFriendsCacheUpdated/);
    assert.match(lobby, /friendRosterActionHtml/);
    assert.match(lobby, /lobbyFriendsHintHtml/);
    assert.match(lobby, /sendMessage: addLobbyMessage/);
    assert.equal((lobby.match(/addLobbyMessage/g) || []).length, 2);
    assert.match(lobby, /data-kick-user/);
    assert.match(lobby, /toggleLocalReady/);
    assert.match(lobby, /kickLobbyMember/);
    assert.doesNotMatch(lobby, /lobby_messages/);
  });

  it("style : actions ami distinctes du kick", () => {
    const css = read("style.css");
    assert.match(css, /\.participant__friend-btn\{/);
    assert.match(css, /\.participant__friend-badge\{/);
    assert.match(css, /\.lobby-friends-hint\{/);
    const rosterUi = read("js/core/friendsRosterUi.js");
    assert.match(rosterUi, /FRIEND_LABEL\.guestCard/);
    assert.match(rosterUi, /FRIEND_LABEL\.guestHint/);
    assert.match(rosterUi, /data-friend-add/);
    assert.match(rosterUi, /data-friend-accept/);
    assert.match(rosterUi, /data-friend-cancel/);
  });
});
