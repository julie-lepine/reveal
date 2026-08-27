/**
 * FEATURE-FRIENDS-02 Palier 5 — popup invitation + badge.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_INVITE_LABEL,
  lobbyInviteBusyCopy,
  lobbyInviteBusyDecision,
  lobbyInviteNoticeCopy,
  lobbyInvitePopupDecision,
} from "../js/config/lobbyInvites.js";
import { friendsBadgeShouldShow } from "../js/core/friendsLogic.js";
import { nextUnseenLobbyInvite } from "../js/core/lobbyInvitesLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-02 Palier 5 — popup + badge", () => {
  it("copy Rejoindre / Refuser ; déjà ailleurs : rester ou quitter", () => {
    const copy = lobbyInviteNoticeCopy({ name: "Léa", emoji: "🎲" });
    assert.equal(copy.message, "Léa t’invite à une soirée");
    assert.equal(copy.confirmLabel, LOBBY_INVITE_LABEL.join);
    assert.equal(copy.cancelLabel, LOBBY_INVITE_LABEL.refuse);
    assert.equal(lobbyInvitePopupDecision(true), "join");
    assert.equal(lobbyInvitePopupDecision(false), "refuse");
    assert.equal(lobbyInvitePopupDecision(null), "dismiss");
    const busy = lobbyInviteBusyCopy({ name: "Léa" });
    assert.equal(busy.title, LOBBY_INVITE_LABEL.busyTitle);
    assert.equal(lobbyInviteBusyDecision(true), "leave_and_join");
    assert.equal(lobbyInviteBusyDecision(false), "stay_and_refuse");
    assert.equal(lobbyInviteBusyDecision(null), "dismiss");
  });

  it("file : une popup par id ; badge demandes ou invitations", () => {
    const a = { id: "i1", fromUserId: "a", lobbyId: "L1", name: "Ada" };
    const b = { id: "i2", fromUserId: "b", lobbyId: "L1", name: "Bo" };
    assert.equal(nextUnseenLobbyInvite([a, b], new Set()).id, "i1");
    assert.equal(nextUnseenLobbyInvite([a, b], new Set(["i1"])).id, "i2");
    assert.equal(nextUnseenLobbyInvite([a], new Set(["i1"])), null);
    assert.equal(friendsBadgeShouldShow(0, 0), false);
    assert.equal(friendsBadgeShouldShow(0, 1), true);
    assert.equal(friendsBadgeShouldShow(1, 0), true);
  });

  it("lobbyInviteNotice : confirm, pas de chat, pas de popup en manche", () => {
    const src = read("js/core/lobbyInviteNotice.js");
    assert.match(src, /showAppConfirm/);
    assert.match(src, /dismissResult:\s*null/);
    assert.match(src, /lobbyInvitePopupDecision/);
    assert.match(src, /lobbyInviteBusyDecision/);
    assert.match(src, /joinFromLobbyInvite/);
    assert.match(src, /refuseLobbyInvite/);
    assert.match(src, /leaveAndJoinFromLobbyInvite/);
    assert.match(src, /canShowFriendRequestPopup/);
    assert.match(src, /sessionBlocksInvitePopup|sessionInPlay/);
    assert.match(src, /syncFriendsEntryBadges/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /addLobbyMessage/);
  });

  it("boot + join sans code hydrate vers le lobby", () => {
    const main = read("js/main.js");
    assert.match(main, /initLobbyInviteNotice/);
    const join = read("js/core/lobbyInviteJoin.js");
    assert.match(join, /acceptLobbyInvite/);
    assert.match(join, /tryRecoverLobbyFromServer/);
    assert.match(join, /navigateAfterLobbyJoin/);
    assert.match(join, /goToLobby/);
    assert.doesNotMatch(join, /find_lobby_by_code/);
    assert.doesNotMatch(join, /lobby_messages/);
    const notice = read("js/core/friendRequestNotice.js");
    assert.match(notice, /getIncomingLobbyInviteCount/);
  });
});
