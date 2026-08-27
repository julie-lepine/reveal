/**
 * FEATURE-FRIENDS-01 Palier 5 — popup incoming + badge, pas de page Amis.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FRIEND_LABEL, isFriendNoticeCalmScreen } from "../js/config/friends.js";
import {
  canShowFriendRequestPopup,
  friendRequestNoticeCopy,
  friendsBadgeShouldShow,
  nextUnseenFriendRequest,
} from "../js/core/friendsLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-01 Palier 5 — notice", () => {
  it("popup seulement écran calme, inscrit, dialog fermé", () => {
    const base = { screenId: "lobby", dialogOpen: false, localIsRegistered: true };
    assert.equal(canShowFriendRequestPopup(base), true);
    assert.equal(canShowFriendRequestPopup({ ...base, screenId: "game-select" }), true);
    assert.equal(canShowFriendRequestPopup({ ...base, screenId: "trivia" }), false);
    assert.equal(canShowFriendRequestPopup({ ...base, screenId: "trivia-prep" }), false);
    assert.equal(canShowFriendRequestPopup({ ...base, screenId: "friends" }), false);
    assert.equal(canShowFriendRequestPopup({ ...base, dialogOpen: true }), false);
    assert.equal(canShowFriendRequestPopup({ ...base, localIsRegistered: false }), false);
    assert.equal(isFriendNoticeCalmScreen("trivia"), false);
  });

  it("file : une popup par id, pas de re-pop", () => {
    const a = { id: "r1", fromUserId: "a", name: "Ada", emoji: "🦊" };
    const b = { id: "r2", fromUserId: "b", name: "Bo", emoji: "🐸" };
    assert.equal(nextUnseenFriendRequest([a, b], new Set()).id, "r1");
    assert.equal(nextUnseenFriendRequest([a, b], new Set(["r1"])).id, "r2");
    assert.equal(nextUnseenFriendRequest([a], new Set(["r1"])), null);
    const copy = friendRequestNoticeCopy(a);
    assert.match(copy.message, /Ada veut t.ajouter/);
    assert.equal(copy.confirmLabel, FRIEND_LABEL.accept);
    assert.equal(copy.cancelLabel, FRIEND_LABEL.refuse);
    assert.equal(copy.icon, "🦊");
    assert.equal(friendsBadgeShouldShow(0), false);
    assert.equal(friendsBadgeShouldShow(1), true);
  });

  it("friendRequestNotice : confirm + decline/accept, pas de chat", () => {
    const src = read("js/core/friendRequestNotice.js");
    assert.match(src, /showAppConfirm/);
    assert.match(src, /isAppDialogOpen/);
    assert.match(src, /acceptFriendRequest/);
    assert.match(src, /declineFriendRequest/);
    assert.match(src, /onScreenChange/);
    assert.match(src, /syncFriendsEntryBadges/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /addLobbyMessage/);
  });

  it("boot + badge Menu / Profil, écran friends branché au palier 6", () => {
    const main = read("js/main.js");
    assert.match(main, /initFriendRequestNotice/);
    assert.match(main, /FRIENDS_SCREEN_ID/);
    const nav = read("js/core/bottomNav.js");
    assert.match(nav, /data-friends-badge/);
    const settings = read("js/screens/settings.js");
    assert.match(settings, /data-friends-badge/);
    const css = read("style.css");
    assert.match(css, /\.friends-badge\{/);
  });
});
