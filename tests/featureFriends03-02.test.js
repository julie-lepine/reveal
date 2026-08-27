/**
 * FEATURE-FRIENDS-03 Palier 2 — couche client sans UI (Annuler / outgoing).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FRIEND_RPC_F03 } from "../js/config/friends.js";
import {
  isOutgoingFriendPending,
  isRegisteredUser,
  friendsCatchupPlan,
  normalizeOutgoingRequestRow,
} from "../js/core/friendsLogic.js";
import {
  clearFriendsCache,
  getOutgoingFriendRequestCount,
  getOutgoingFriendRequests,
  isOutgoingFriendRequestPending,
  markOutgoingFriendPending,
  removeOutgoingFriendRequest,
  setOutgoingFriendRequests,
} from "../js/core/friendsState.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-03 Palier 2 — client", () => {
  beforeEach(() => {
    clearFriendsCache();
  });

  it("supabaseFriends : cancel + listOutgoing, invité skip, pas d’UI", () => {
    const src = read("js/core/supabaseFriends.js");
    assert.match(src, /FRIEND_RPC\.cancel/);
    assert.match(src, /FRIEND_RPC\.listOutgoing/);
    for (const name of Object.values(FRIEND_RPC_F03)) {
      assert.match(src, new RegExp(`FRIEND_RPC\\.\\w+|${name}`));
    }
    assert.match(src, /p_to/);
    assert.match(src, /canCallFriendsRpc/);
    assert.match(src, /isRegisteredUser/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /innerHTML|document\./);
    assert.doesNotMatch(src, /registerScreen/);
  });

  it("cache outgoing hors persist ; clearFriendsCache le vide", () => {
    const state = read("js/core/state.js");
    assert.doesNotMatch(state, /setOutgoingFriendRequests|outgoingFriend/);
    const fs = read("js/core/friendsState.js");
    assert.doesNotMatch(fs, /localStorage/);
    setOutgoingFriendRequests([
      { id: "r1", to_user_id: "b", display_name: "Léa", emoji: "🦊" },
    ]);
    assert.equal(getOutgoingFriendRequestCount(), 1);
    assert.equal(getOutgoingFriendRequests()[0].toUserId, "b");
    clearFriendsCache();
    assert.equal(getOutgoingFriendRequestCount(), 0);
  });

  it("normalise outgoing + optimistic pending + remove", () => {
    assert.equal(normalizeOutgoingRequestRow({ id: "1" }), null);
    const row = normalizeOutgoingRequestRow({
      id: "r1",
      to_user_id: "b",
      display_name: "Léa",
      emoji: "🦊",
    });
    assert.equal(row.toUserId, "b");
    assert.equal(row.name, "Léa");
    assert.equal(isOutgoingFriendPending([row], "b"), true);
    assert.equal(isOutgoingFriendPending([row], "c"), false);
    assert.equal(isOutgoingFriendRequestPending("b"), false);
    markOutgoingFriendPending("b");
    assert.equal(isOutgoingFriendRequestPending("b"), true);
    markOutgoingFriendPending("b");
    assert.equal(getOutgoingFriendRequestCount(), 1);
    removeOutgoingFriendRequest("b");
    assert.equal(isOutgoingFriendRequestPending("b"), false);
    assert.equal(isRegisteredUser({ loggedIn: true, isGuest: true }), false);
  });

  it("catch-up : outgoing toujours ; Realtime fetch outgoing", () => {
    assert.equal(friendsCatchupPlan({ inLobby: false }).outgoing, true);
    assert.equal(friendsCatchupPlan({ inLobby: true, lobbyId: "L" }).outgoing, true);
    const rt = read("js/core/friendsRealtime.js");
    assert.match(rt, /fetchOutgoingFriendRequests/);
    assert.match(rt, /plan\.outgoing/);
  });
});
