/**
 * FEATURE-FRIENDS-01 Palier 0 — contrats figés.
 * Pas d’UI, pas de SQL : les paliers suivants importent js/config/friends.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIENDS_FEATURE_ID,
  FRIENDS_SCREEN_ID,
  FRIENDS_TABLE,
  FRIEND_OVERLAY,
  FRIEND_OVERLAY_STATUSES,
  FRIEND_RPC_F01,
  FRIEND_RPC_ERROR,
  FRIEND_REQUEST_COOLDOWN_MS,
  FRIEND_LABEL,
  FRIEND_ROSTER_ACTION,
  FRIEND_NOTICE_CALM_SCREENS,
  rosterActionFromOverlay,
  isFriendNoticeCalmScreen,
  friendsRealtimeTopic,
} from "../js/config/friends.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const friendsDoc = readFileSync(join(ROOT, "docs/FRIENDS.md"), "utf8");
const configSrc = readFileSync(join(ROOT, "js/config/friends.js"), "utf8");

describe("FEATURE-FRIENDS-01 Palier 0 — contrats", () => {
  it("vague, écran dédié, tables, pas de graphe dans lobby_members", () => {
    assert.equal(FRIENDS_FEATURE_ID, "FEATURE-FRIENDS-01");
    assert.equal(FRIENDS_SCREEN_ID, "friends");
    assert.equal(FRIENDS_TABLE.requests, "friend_requests");
    assert.equal(FRIENDS_TABLE.friendships, "friendships");
    assert.equal(FRIENDS_TABLE.cooldowns, "friend_request_cooldowns");
    assert.match(configSrc, /Pas de colonnes d’amitié sur lobby_members/);
    assert.doesNotMatch(configSrc, /from\(["']lobby_members["']/);
  });

  it("overlay : 5 statuts, self omis, guest = anonyme", () => {
    assert.deepEqual([...FRIEND_OVERLAY_STATUSES], [
      "guest",
      "none",
      "pending_out",
      "pending_in",
      "friends",
    ]);
    assert.equal(FRIEND_OVERLAY.guest, "guest");
    assert.equal(FRIEND_OVERLAY.pendingOut, "pending_out");
    assert.ok(!FRIEND_OVERLAY_STATUSES.includes("self"));
    assert.ok(!FRIEND_OVERLAY_STATUSES.includes("declined"));
  });

  it("RPC + erreurs métier figées (cooldown silencieux)", () => {
    assert.deepEqual(FRIEND_RPC_F01, {
      send: "send_friend_request",
      decline: "decline_friend_request",
      accept: "accept_friend_request",
      unfriend: "unfriend",
      overlay: "get_lobby_friend_overlay",
      listFriends: "list_my_friends",
      listIncoming: "list_incoming_friend_requests",
    });
    assert.equal(FRIEND_RPC_ERROR.cooldown, "friends_cooldown");
    assert.equal(FRIEND_REQUEST_COOLDOWN_MS, 60_000);
    assert.equal(FRIEND_LABEL.add, "+ Ami");
    assert.equal(FRIEND_LABEL.guestCard, "Pas de compte");
    assert.equal(FRIEND_LABEL.sent, "Envoyée");
  });

  it("roster : inscrit+none = + Ami ; refus/cooldown restent add ; invité = hint carte", () => {
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.none, { localIsRegistered: true }),
      FRIEND_ROSTER_ACTION.add
    );
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.pendingOut, { localIsRegistered: true }),
      FRIEND_ROSTER_ACTION.cancel
    );
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.pendingIn, { localIsRegistered: true }),
      FRIEND_ROSTER_ACTION.accept
    );
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.friends, { localIsRegistered: true }),
      FRIEND_ROSTER_ACTION.friend
    );
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.guest, { localIsRegistered: true }),
      FRIEND_ROSTER_ACTION.hintGuest
    );
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.none, { localIsRegistered: false }),
      FRIEND_ROSTER_ACTION.hintGuest
    );
    assert.equal(FRIEND_LABEL.guestHint, "Crée un compte pour ajouter des amis");
  });

  it("popup seulement sur écrans calmes", () => {
    for (const id of [
      "lobby",
      "game-select",
      "results",
      "leaderboard",
      "friends",
      "settings",
      "help-legal",
      "home",
    ]) {
      assert.equal(isFriendNoticeCalmScreen(id), true, id);
    }
    assert.ok(FRIEND_NOTICE_CALM_SCREENS.has("lobby"));
    assert.equal(isFriendNoticeCalmScreen("trivia"), false);
    assert.equal(isFriendNoticeCalmScreen("drawit"), false);
    assert.equal(isFriendNoticeCalmScreen("hottake-prep"), false);
  });

  it("topic realtime hors canal lobby", () => {
    assert.equal(friendsRealtimeTopic("abc"), "friends:abc");
    assert.doesNotMatch(friendsRealtimeTopic("abc"), /^lobby:/);
  });

  it("docs/FRIENDS.md nomme les mêmes RPC et l’écran friends", () => {
    for (const name of Object.values(FRIEND_RPC_F01)) {
      assert.match(friendsDoc, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(friendsDoc, /js\/screens\/friends\.js/);
    assert.match(friendsDoc, /js\/config\/friends\.js/);
  });
});
