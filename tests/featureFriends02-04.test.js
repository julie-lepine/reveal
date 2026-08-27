/**
 * FEATURE-FRIENDS-02 Palier 4 — page Amis Inviter / incoming + entrée waiting room.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_INVITE_ACTION,
  LOBBY_INVITE_LABEL,
  LOBBY_INVITE_RPC_ERROR,
  friendInviteAction,
} from "../js/config/lobbyInvites.js";
import {
  lobbyInviteFailMessage,
  shouldShowLobbyInviteFriendsEntry,
} from "../js/core/lobbyInvitesLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-02 Palier 4 — page Amis invitations", () => {
  it("Inviter seulement inscrit + lobby ; déjà là = Dans la soirée", () => {
    assert.equal(
      friendInviteAction({ localIsRegistered: true, localInLobby: true }),
      LOBBY_INVITE_ACTION.invite
    );
    assert.equal(
      friendInviteAction({
        localIsRegistered: true,
        localInLobby: true,
        pendingOut: true,
      }),
      LOBBY_INVITE_ACTION.sent
    );
    assert.equal(
      friendInviteAction({
        localIsRegistered: true,
        localInLobby: true,
        peerInSameLobby: true,
      }),
      LOBBY_INVITE_ACTION.alreadyIn
    );
    assert.equal(
      friendInviteAction({ localIsRegistered: true, localInLobby: false }),
      LOBBY_INVITE_ACTION.omit
    );
    assert.equal(LOBBY_INVITE_LABEL.invite, "Inviter");
    assert.equal(LOBBY_INVITE_LABEL.sent, "Envoyée");
    assert.equal(LOBBY_INVITE_LABEL.alreadyIn, "Dans la soirée");
    assert.equal(LOBBY_INVITE_LABEL.join, "Rejoindre");
    assert.equal(LOBBY_INVITE_LABEL.refuse, "Refuser");
    assert.equal(
      LOBBY_INVITE_LABEL.noLobbyHint,
      "Crée ou rejoins une soirée pour inviter tes amis."
    );
  });

  it("friends.js : section incoming, Inviter, pas de chat, pas de leave", () => {
    const src = read("js/screens/friends.js");
    assert.match(src, /data-lobby-invites-incoming/);
    assert.match(src, /data-lobby-invite-send/);
    assert.match(src, /data-lobby-invite-join/);
    assert.match(src, /data-lobby-invite-refuse/);
    assert.match(src, /data-lobby-invite-no-lobby/);
    assert.match(src, /data-lobby-invites-empty/);
    assert.match(src, /sendLobbyInvite/);
    assert.match(src, /declineLobbyInvite/);
    assert.match(src, /acceptLobbyInvite/);
    assert.match(src, /friendInviteAction/);
    assert.match(src, /LOBBY_INVITE_LABEL/);
    assert.match(src, /fetchIncomingLobbyInvites/);
    assert.match(src, /fetchOutgoingLobbyInvites/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /leaveLobby/);
    assert.doesNotMatch(src, /busyConfirm/);
  });

  it("waiting room : entrée Amis si ≥1 ami ; pas de ligne chat invite", () => {
    const lobby = read("js/screens/lobby.js");
    assert.match(lobby, /data-lobby-invite-friends/);
    assert.match(lobby, /LOBBY_INVITE_LABEL\.entryLobby/);
    assert.match(lobby, /shouldShowLobbyInviteFriendsEntry/);
    assert.match(lobby, /FRIENDS_SCREEN_ID/);
    assert.doesNotMatch(lobby, /lobby_messages/);
    assert.equal((lobby.match(/addLobbyMessage/g) || []).length, 2);
    assert.equal(shouldShowLobbyInviteFriendsEntry({ localIsRegistered: true, friendCount: 1 }), true);
    assert.equal(shouldShowLobbyInviteFriendsEntry({ localIsRegistered: true, friendCount: 0 }), false);
    assert.equal(shouldShowLobbyInviteFriendsEntry({ localIsRegistered: false, friendCount: 3 }), false);
    assert.equal(LOBBY_INVITE_LABEL.entryLobby, "Inviter des amis");
  });

  it("erreurs métier lisibles ; CSS pastille / entrée", () => {
    assert.equal(
      lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.noLobby),
      LOBBY_INVITE_LABEL.noLobbyHint
    );
    assert.equal(
      lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.alreadyIn),
      LOBBY_INVITE_LABEL.alreadyIn
    );
    assert.match(lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.busy), /une à la fois/);
    assert.match(lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.full), /complète/);
    const css = read("style.css");
    assert.match(css, /\.friends-row__badge\{/);
    assert.match(css, /\.lobby-invite-friends-entry\{/);
  });
});
