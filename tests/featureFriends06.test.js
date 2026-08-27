/**
 * FEATURE-FRIENDS-01 Palier 6 — écran friends + entrées UI.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIEND_LABEL,
  FRIENDS_ENTRY,
  FRIENDS_SCREEN_ID,
} from "../js/config/friends.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-01 Palier 6 — page Amis", () => {
  it("écran friends enregistré, pas un onglet bottom-nav", () => {
    const main = read("js/main.js");
    assert.match(main, /registerScreen\(FRIENDS_SCREEN_ID/);
    assert.equal(FRIENDS_SCREEN_ID, "friends");
    const nav = read("js/core/bottomNav.js");
    assert.doesNotMatch(nav, /data-tab-nav="friends"/);
    assert.match(nav, /friends:\s*TAB_SETTINGS/);
  });

  it("invité : empty state compte ; inscrit : demandes + liste", () => {
    const src = read("js/screens/friends.js");
    assert.match(src, /data-friends-guest/);
    assert.match(src, /FRIEND_LABEL\.guestHint/);
    assert.match(src, /data-friends-incoming/);
    assert.match(src, /data-friends-list/);
    assert.match(src, /data-friend-accept/);
    assert.match(src, /data-friend-refuse/);
    assert.match(src, /acceptFriendRequest/);
    assert.match(src, /declineFriendRequest/);
    assert.match(src, /fetchMyFriends/);
    assert.match(src, /data-friends-incoming-empty/);
    assert.match(src, /data-friends-list-empty/);
    assert.match(src, /data-friend-unfriend/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.equal(FRIEND_LABEL.incomingSection, "Demandes reçues");
    assert.equal(FRIEND_LABEL.friendsSection, "Tes amis");
  });

  it("entrées Settings Profil + accueil inscrit + badge", () => {
    const settings = read("js/screens/settings.js");
    assert.match(settings, /FRIENDS_SCREEN_ID/);
    assert.match(settings, /FRIENDS_ENTRY\.settingsProfile/);
    assert.match(settings, /FRIEND_LABEL\.entrySettings/);
    assert.equal(FRIENDS_ENTRY.settingsProfile, "settings-profile");
    const home = read("js/screens/home.js");
    assert.match(home, /FRIENDS_SCREEN_ID/);
    assert.match(home, /FRIENDS_ENTRY\.homeLoggedIn/);
    assert.match(home, /auth-welcome__nav/);
    assert.match(home, /syncFriendsEntryBadges/);
    const nav = read("js/screens/nav.js");
    assert.match(nav, /target === "friends"/);
  });

  it("friends est du chrome soirée, pas une manche", () => {
    const sync = read("js/core/gameSync.js");
    const menuBlock = sync.slice(
      sync.indexOf("const MENU_SCREENS"),
      sync.indexOf("export function isPassiveChromeScreen")
    );
    assert.match(menuBlock, /"friends"/);
    assert.match(menuBlock, /"settings"/);
    assert.match(sync, /screen === "friends"/);
    const nav = read("js/screens/nav.js");
    const fn = nav.slice(
      nav.indexOf("export function goToFriends"),
      nav.indexOf("export function goToEveningSettings")
    );
    assert.match(fn, /suppressSessionRoute/);
    assert.match(fn, /navigate\("friends"\)/);
    assert.match(nav, /target === "friends"/);
    assert.match(nav, /goToFriends\(\)/);
    assert.doesNotMatch(fn, /exitGameToGameSelect/);
  });
});
