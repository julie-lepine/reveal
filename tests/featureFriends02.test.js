/**
 * FEATURE-FRIENDS-02 Palier 2 — couche client sans UI.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_INVITE_ACTION,
  LOBBY_INVITE_RPC,
  LOBBY_INVITE_RPC_ERROR,
  LOBBY_INVITE_TABLE,
  friendInviteAction,
} from "../js/config/lobbyInvites.js";
import { isRegisteredUser } from "../js/core/friendsLogic.js";
import {
  isOutgoingInvitePending,
  normalizeIncomingLobbyInviteRow,
  normalizeOutgoingLobbyInviteRow,
  parseLobbyInviteRpcError,
} from "../js/core/lobbyInvitesLogic.js";
import {
  clearLobbyInvitesCache,
  getIncomingLobbyInviteCount,
  getIncomingLobbyInvites,
  getOutgoingLobbyInvites,
  isLobbyInvitePendingOut,
  markLobbyInvitePendingOut,
  removeOutgoingLobbyInvite,
  setIncomingLobbyInvites,
  setOutgoingLobbyInvites,
} from "../js/core/lobbyInvitesState.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-02 Palier 2 — client", () => {
  beforeEach(() => {
    clearLobbyInvitesCache();
  });

  it("supabaseLobbyInvites : RPC du contrat, SELECT outgoing, pas de chat, pas d’UI", () => {
    const src = read("js/core/supabaseLobbyInvites.js");
    for (const name of Object.values(LOBBY_INVITE_RPC)) {
      assert.match(src, new RegExp(`LOBBY_INVITE_RPC\\.\\w+|${name}`));
    }
    assert.match(src, /p_to/);
    assert.match(src, /p_id/);
    assert.match(src, new RegExp(`from\\(${LOBBY_INVITE_TABLE}\\)|from\\(LOBBY_INVITE_TABLE\\)`));
    assert.match(src, /id, lobby_id, to_user_id/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /innerHTML|document\./);
    assert.doesNotMatch(src, /registerScreen/);
    assert.match(src, /isRegisteredUser/);
  });

  it("cache hors persist / localStorage ; invité = pas de graphe invite", () => {
    const state = read("js/core/state.js");
    assert.doesNotMatch(state, /lobbyInvitesState|lobby_invites|setIncomingLobbyInvites/);
    const fs = read("js/core/lobbyInvitesState.js");
    assert.doesNotMatch(fs, /localStorage/);
    assert.doesNotMatch(fs, /scheduleSave/);
    assert.equal(isRegisteredUser({ loggedIn: true, isGuest: true }), false);
    assert.equal(isRegisteredUser({ loggedIn: true, isGuest: false }), true);
  });

  it("parse erreurs + busy n’est pas un auto-leave", () => {
    assert.equal(
      parseLobbyInviteRpcError({ message: "lobby_invite_busy" }),
      LOBBY_INVITE_RPC_ERROR.busy
    );
    assert.equal(
      parseLobbyInviteRpcError({ message: "lobby_invite_not_friends" }),
      LOBBY_INVITE_RPC_ERROR.notFriends
    );
    assert.equal(
      parseLobbyInviteRpcError({ message: "friends_guest" }),
      LOBBY_INVITE_RPC_ERROR.guest
    );
    const src = read("js/core/supabaseLobbyInvites.js");
    assert.doesNotMatch(src, /leaveLobby/);
  });

  it("normalise incoming (sans code) + outgoing pending", () => {
    assert.equal(normalizeIncomingLobbyInviteRow({ id: "1" }), null);
    const row = normalizeIncomingLobbyInviteRow({
      id: "i1",
      from_user_id: "a",
      lobby_id: "L1",
      display_name: "Léa",
      emoji: "🎲",
    });
    assert.equal(row.fromUserId, "a");
    assert.equal(row.lobbyId, "L1");
    assert.equal(row.name, "Léa");
    assert.equal(row.code, undefined);
    const out = normalizeOutgoingLobbyInviteRow({
      id: "o1",
      to_user_id: "b",
      lobby_id: "L1",
    });
    assert.equal(out.toUserId, "b");
    assert.equal(
      isOutgoingInvitePending([out], "L1", "b"),
      true
    );
    assert.equal(isOutgoingInvitePending([out], "L1", "c"), false);
  });

  it("cache incoming + optimistic Envoyée + rollback", () => {
    setIncomingLobbyInvites([
      { id: "i1", from_user_id: "a", lobby_id: "L1", display_name: "Léa" },
    ]);
    assert.equal(getIncomingLobbyInviteCount(), 1);
    assert.equal(getIncomingLobbyInvites()[0].fromUserId, "a");
    setOutgoingLobbyInvites([]);
    assert.equal(isLobbyInvitePendingOut("L1", "b"), false);
    markLobbyInvitePendingOut("L1", "b");
    assert.equal(isLobbyInvitePendingOut("L1", "b"), true);
    assert.equal(getOutgoingLobbyInvites().length, 1);
    removeOutgoingLobbyInvite("L1", "b");
    assert.equal(isLobbyInvitePendingOut("L1", "b"), false);
    assert.equal(
      friendInviteAction({
        localIsRegistered: true,
        localInLobby: true,
        pendingOut: true,
      }),
      LOBBY_INVITE_ACTION.sent
    );
  });

  it("home pas branché aux invitations au palier 2", () => {
    const home = read("js/screens/home.js");
    assert.doesNotMatch(home, /sendLobbyInvite|fetchIncomingLobbyInvites/);
  });
});
