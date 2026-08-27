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
  friendRequestPopupDecision,
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
    assert.equal(canShowFriendRequestPopup({ ...base, screenId: "settings", sessionInPlay: true }), false);
    assert.equal(canShowFriendRequestPopup({ ...base, screenId: "lobby", sessionInPlay: true }), false);
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
    assert.equal(friendRequestPopupDecision(true), "accept");
    assert.equal(friendRequestPopupDecision(false), "refuse");
    assert.equal(friendRequestPopupDecision(null), "dismiss");
    assert.equal(friendRequestPopupDecision(undefined), "dismiss");
  });

  it("friendRequestNotice : confirm + decline/accept, pas de chat", () => {
    const src = read("js/core/friendRequestNotice.js");
    assert.match(src, /showAppConfirm/);
    assert.match(src, /dismissResult:\s*null/);
    assert.match(src, /friendRequestPopupDecision/);
    assert.match(src, /isAppDialogOpen/);
    assert.match(src, /acceptFriendRequest/);
    assert.match(src, /declineFriendRequest/);
    assert.match(src, /decision === "refuse"/);
    assert.match(src, /onScreenChange/);
    assert.match(src, /sessionBlocksFriendPopup|sessionInPlay/);
    assert.match(src, /syncFriendsEntryBadges/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /addLobbyMessage/);
    const dialog = read("js/core/dialog.js");
    assert.match(dialog, /dismissResult = false/);
    assert.match(dialog, /close\(dismissResult\)/);
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
