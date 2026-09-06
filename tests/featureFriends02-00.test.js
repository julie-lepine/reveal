/**
 * FEATURE-FRIENDS-02 Palier 0 — contrats invitations de lobby.
 * Pas d’UI, pas de SQL : les paliers suivants importent js/config/lobbyInvites.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIEND_NOTICE_CALM_SCREENS,
  FRIENDS_FEATURE_ID,
  friendsRealtimeTopic,
} from "../js/config/friends.js";
import {
  LOBBY_INVITES_FEATURE_ID,
  LOBBY_INVITE_ACTION,
  LOBBY_INVITE_LABEL,
  LOBBY_INVITE_RPC,
  LOBBY_INVITE_RPC_ERROR,
  LOBBY_INVITE_TABLE,
  LOBBY_INVITE_UNIQUE,
  friendInviteAction,
  lobbyInviteBusyCopy,
  lobbyInviteBusyDecision,
  lobbyInviteNoticeCopy,
  lobbyInvitePopupDecision,
} from "../js/config/lobbyInvites.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const friendsDoc = readFileSync(join(ROOT, "docs/FRIENDS.md"), "utf8");
const configSrc = readFileSync(join(ROOT, "js/config/lobbyInvites.js"), "utf8");

describe("FEATURE-FRIENDS-02 Palier 0 — contrats invitations", () => {
  it("vague dédiée, table hors lobby_members, pas le code lobby", () => {
    assert.equal(LOBBY_INVITES_FEATURE_ID, "FEATURE-FRIENDS-02");
    assert.notEqual(FRIENDS_FEATURE_ID, LOBBY_INVITES_FEATURE_ID);
    assert.equal(LOBBY_INVITE_TABLE, "lobby_invites");
    assert.equal(LOBBY_INVITE_UNIQUE, "lobby_id_to_user_id");
    assert.match(configSrc, /Pas de colonnes d’invite sur lobby_members/);
    assert.match(configSrc, /Pas le code lobby/);
    assert.match(configSrc, /ses amis inscrits hors salle/);
    assert.match(configSrc, /plafond \(8, ou 14 si l’hôte a Maître de soirée\) s’applique au \*\*Rejoindre\*\*/);
    assert.doesNotMatch(configSrc, /from\(["']lobby_members["']/);
  });

  it("RPC + erreurs métier (busy = déjà ailleurs, pas d’auto-leave serveur)", () => {
    assert.deepEqual(LOBBY_INVITE_RPC, {
      send: "send_lobby_invite",
      decline: "decline_lobby_invite",
      accept: "accept_lobby_invite",
      listIncoming: "list_incoming_lobby_invites",
    });
    assert.equal(LOBBY_INVITE_RPC_ERROR.guest, "friends_guest");
    assert.equal(LOBBY_INVITE_RPC_ERROR.self, "friends_self");
    assert.equal(LOBBY_INVITE_RPC_ERROR.notFriends, "lobby_invite_not_friends");
    assert.equal(LOBBY_INVITE_RPC_ERROR.busy, "lobby_invite_busy");
    assert.equal(LOBBY_INVITE_RPC_ERROR.full, "lobby_invite_full");
    assert.equal(LOBBY_INVITE_RPC_ERROR.closed, "lobby_invite_closed");
  });

  it("Inviter seulement inscrit + dans un lobby ; ami déjà là = Dans la soirée", () => {
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
    assert.equal(
      friendInviteAction({ localIsRegistered: false, localInLobby: true }),
      LOBBY_INVITE_ACTION.omit
    );
    assert.equal(LOBBY_INVITE_LABEL.invite, "Inviter");
    assert.equal(LOBBY_INVITE_LABEL.join, "Rejoindre");
    assert.equal(LOBBY_INVITE_LABEL.alreadyIn, "Dans la soirée");
  });

  it("popup Rejoindre / Refuser ; déjà ailleurs : rester+refuser ou quitter+rejoindre", () => {
    const copy = lobbyInviteNoticeCopy({ name: "Léa", emoji: "🎲" });
    assert.equal(copy.title, "Invitation");
    assert.equal(copy.message, "Léa t’invite à une soirée");
    assert.equal(copy.confirmLabel, "Rejoindre");
    assert.equal(copy.cancelLabel, "Refuser");
    assert.equal(lobbyInvitePopupDecision(true), "join");
    assert.equal(lobbyInvitePopupDecision(false), "refuse");
    assert.equal(lobbyInvitePopupDecision(null), "dismiss");
    const busy = lobbyInviteBusyCopy({ name: "Léa", emoji: "🎲" });
    assert.equal(busy.title, "Tu es déjà dans une soirée");
    assert.match(busy.message, /une autre soirée/);
    assert.match(busy.message, /une à la fois/);
    assert.equal(busy.confirmLabel, "Quitter et rejoindre");
    assert.equal(busy.cancelLabel, "Rester et refuser");
    assert.equal(lobbyInviteBusyDecision(true), "leave_and_join");
    assert.equal(lobbyInviteBusyDecision(false), "stay_and_refuse");
    assert.equal(lobbyInviteBusyDecision(null), "dismiss");
  });

  it("même canal friends:uid ; mêmes écrans calmes que les demandes d’ami", () => {
    assert.equal(friendsRealtimeTopic("abc"), "friends:abc");
    assert.ok(FRIEND_NOTICE_CALM_SCREENS.has("home"));
    assert.ok(FRIEND_NOTICE_CALM_SCREENS.has("friends"));
    assert.equal(FRIEND_NOTICE_CALM_SCREENS.has("trivia"), false);
  });

  it("docs/FRIENDS.md nomme FEATURE-FRIENDS-02 et les RPC", () => {
    assert.match(friendsDoc, /FEATURE-FRIENDS-02/);
    for (const name of Object.values(LOBBY_INVITE_RPC)) {
      assert.match(friendsDoc, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(friendsDoc, /js\/config\/lobbyInvites\.js/);
    assert.match(friendsDoc, /Rester et refuser/);
    assert.match(friendsDoc, /Quitter et rejoindre/);
    assert.match(friendsDoc, /tous tes amis inscrits/);
  });
});
