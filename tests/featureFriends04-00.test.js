/**
 * FEATURE-FRIENDS-04 Palier 0 — contrats croisés récents 24 h.
 * Pas d’UI, pas de SQL : palier 1 = feature-friends-04.sql.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIEND_OVERLAY,
  FRIEND_ROSTER_ACTION,
  FRIENDS_FEATURE_ID,
} from "../js/config/friends.js";
import {
  FRIENDS_04_FEATURE_ID,
  RECENT_PEERS_LABEL,
  RECENT_PEERS_PAIR_ORDER,
  RECENT_PEERS_RPC,
  RECENT_PEERS_TABLE,
  RECENT_PEERS_WINDOW_MS,
  RECENT_PEER_ACTION,
  encounterPair,
  recentPeerAction,
  recentPeerIsInWindow,
  recentPeerShouldList,
} from "../js/config/recentPeers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const friendsDoc = readFileSync(join(ROOT, "docs/FRIENDS.md"), "utf8");
const configSrc = readFileSync(join(ROOT, "js/config/recentPeers.js"), "utf8");

describe("FEATURE-FRIENDS-04 Palier 0 — contrats croisés récents", () => {
  it("vague dédiée, table hors lobby_members, pas le code lobby", () => {
    assert.equal(FRIENDS_04_FEATURE_ID, "FEATURE-FRIENDS-04");
    assert.notEqual(FRIENDS_FEATURE_ID, FRIENDS_04_FEATURE_ID);
    assert.equal(RECENT_PEERS_TABLE, "lobby_encounters");
    assert.equal(RECENT_PEERS_PAIR_ORDER, "user_a < user_b");
    assert.equal(RECENT_PEERS_WINDOW_MS, 24 * 60 * 60 * 1000);
    assert.match(configSrc, /Pas de colonnes d’amitié \/ d’invite sur lobby_members/);
    assert.match(configSrc, /Pas d’INSERT client/);
    assert.match(configSrc, /Pas le code salon/);
    assert.doesNotMatch(configSrc, /from\(["']lobby_members["']/);
    assert.doesNotMatch(configSrc, /\bfetch\s*\(/);
    assert.doesNotMatch(configSrc, /document\./);
    assert.doesNotMatch(configSrc, /lobby_messages/);
  });

  it("une RPC list, sans lobby_id / code ; paire ordonnée", () => {
    assert.deepEqual(RECENT_PEERS_RPC, { list: "list_recent_lobby_peers" });
    assert.deepEqual(encounterPair("b", "a"), { userA: "a", userB: "b" });
    assert.equal(encounterPair("a", "a"), null);
    assert.equal(encounterPair("", "b"), null);
  });

  it("fenêtre 24 h ; encore ensemble / ami / invité exclus", () => {
    const now = Date.parse("2026-08-27T21:00:00Z");
    assert.equal(recentPeerIsInWindow("2026-08-27T10:00:00Z", now), true);
    assert.equal(recentPeerIsInWindow("2026-08-26T21:00:00Z", now), true);
    assert.equal(recentPeerIsInWindow("2026-08-26T20:59:00Z", now), false);
    const base = {
      localIsRegistered: true,
      peerIsRegistered: true,
      lastSharedAt: "2026-08-27T10:00:00Z",
      now,
    };
    assert.equal(recentPeerShouldList(base), true);
    assert.equal(recentPeerShouldList({ ...base, currentlyInSameLobby: true }), false);
    assert.equal(recentPeerShouldList({ ...base, alreadyFriends: true }), false);
    assert.equal(recentPeerShouldList({ ...base, peerIsRegistered: false }), false);
    assert.equal(recentPeerShouldList({ ...base, localIsRegistered: false }), false);
  });

  it("actions + Ami / Annuler / Accepter ; jamais Inviter", () => {
    const opts = { localIsRegistered: true };
    assert.equal(recentPeerAction(FRIEND_OVERLAY.none, opts), RECENT_PEER_ACTION.add);
    assert.equal(recentPeerAction(FRIEND_OVERLAY.pendingOut, opts), RECENT_PEER_ACTION.cancel);
    assert.equal(recentPeerAction(FRIEND_OVERLAY.pendingIn, opts), RECENT_PEER_ACTION.accept);
    assert.equal(recentPeerAction(FRIEND_OVERLAY.friends, opts), RECENT_PEER_ACTION.omit);
    assert.equal(
      recentPeerAction(FRIEND_OVERLAY.none, { ...opts, currentlyInSameLobby: true }),
      RECENT_PEER_ACTION.omit
    );
    assert.equal(RECENT_PEER_ACTION.add, FRIEND_ROSTER_ACTION.add);
    assert.equal(RECENT_PEER_ACTION.cancel, FRIEND_ROSTER_ACTION.cancel);
    assert.equal(RECENT_PEER_ACTION.invite, undefined);
    assert.doesNotMatch(configSrc, /LOBBY_INVITE_ACTION/);
    assert.equal(RECENT_PEERS_LABEL.section, "Vous venez de jouer avec");
    assert.equal(RECENT_PEERS_LABEL.empty, "Personne récemment.");
  });

  it("docs/FRIENDS.md nomme FEATURE-FRIENDS-04, la table et la RPC", () => {
    assert.match(friendsDoc, /FEATURE-FRIENDS-04/);
    assert.match(friendsDoc, /list_recent_lobby_peers/);
    assert.match(friendsDoc, /lobby_encounters/);
    assert.match(friendsDoc, /Vous venez de jouer avec/);
    assert.match(friendsDoc, /Personne récemment/);
    assert.match(friendsDoc, /24 h/);
  });
});
