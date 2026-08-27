/**
 * FEATURE-FRIENDS-01 Palier 7bis — + Ami pendant la soirée (Menu → Joueurs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lobbySettingsActionsForRole } from "../js/core/partySettingsMenu.js";
import { canShowFriendRequestPopup } from "../js/core/friendsLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-01 Palier 7bis — + Ami soirée", () => {
  it("inscrit membre : Joueurs ; invité : leave seulement ; kick hôte", () => {
    assert.deepEqual([...lobbySettingsActionsForRole("host")], [
      "transfer",
      "players",
      "close",
    ]);
    assert.deepEqual([...lobbySettingsActionsForRole("member")], ["leave"]);
    assert.deepEqual(
      [...lobbySettingsActionsForRole("member", { localIsRegistered: true })],
      ["players", "leave"]
    );
    assert.equal(lobbySettingsActionsForRole("member", { localIsRegistered: true }).includes("close"), false);
  });

  it("settings : liste pour inscrits, kick hôte, mêmes actions roster", () => {
    const settings = read("js/screens/settings.js");
    assert.match(settings, /localIsRegistered:\s*registered/);
    assert.match(settings, /data-settings-party="players"/);
    assert.match(settings, /isLobbyHost\(\) && canManageLobbyRoster\(\)/);
    assert.match(settings, /friendRosterActionHtml/);
    assert.match(settings, /sendLobbyFriendRequest/);
    assert.match(settings, /acceptLobbyFriendRequest/);
    assert.match(settings, /cancelLobbyFriendRequest/);
    assert.match(settings, /flushFriendRequestNotice/);
    assert.match(settings, /lobbyFriendsHintHtml/);
    assert.doesNotMatch(settings, /lobby_messages/);
    const dialog = read("js/core/dialog.js");
    assert.match(dialog, /data-friend-add/);
    assert.match(dialog, /onFriendAdd/);
    assert.match(dialog, /onFriendAccept/);
    assert.match(dialog, /onFriendCancel/);
    assert.match(dialog, /data-friend-cancel/);
    assert.match(dialog, /canKick && p\.userId/);
  });

  it("pendant une manche : pas de popup même sur Menu", () => {
    const base = { screenId: "settings", dialogOpen: false, localIsRegistered: true };
    assert.equal(canShowFriendRequestPopup(base), true);
    assert.equal(canShowFriendRequestPopup({ ...base, sessionInPlay: true }), false);
    const notice = read("js/core/friendRequestNotice.js");
    assert.match(notice, /isSessionInProgressPlay/);
    assert.match(notice, /isOnGameSetupScreen/);
  });
});
