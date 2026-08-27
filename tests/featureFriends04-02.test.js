/**
 * FEATURE-FRIENDS-04 Palier 2 — couche client sans UI (croisés 24 h).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FRIEND_OVERLAY } from "../js/config/friends.js";
import {
  RECENT_PEERS_TABLE,
  recentPeerAction,
  RECENT_PEER_ACTION,
} from "../js/config/recentPeers.js";
import { isRegisteredUser } from "../js/core/friendsLogic.js";
import {
  normalizeRecentPeerRow,
  overlayStatusForRecentPeer,
  recentPeerKeepListed,
  recentPeersCatchupPlan,
} from "../js/core/recentPeersLogic.js";
import {
  clearRecentPeersCache,
  getRecentLobbyPeers,
  setRecentLobbyPeers,
} from "../js/core/recentPeersState.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-04 Palier 2 — client", () => {
  beforeEach(() => {
    clearRecentPeersCache();
  });

  it("supabaseRecentPeers : RPC list, invité skip, pas d’INSERT, pas d’UI", () => {
    const src = read("js/core/supabaseRecentPeers.js");
    assert.match(src, /RECENT_PEERS_RPC\.list/);
    assert.match(src, /supabase\.rpc\(RECENT_PEERS_RPC\.list/);
    assert.match(src, /canCallRecentPeersRpc/);
    assert.match(src, /isRegisteredUser/);
    assert.match(src, /skipped: true/);
    assert.match(src, /inLobby/);
    assert.match(src, /console\.warn/);
    assert.doesNotMatch(src, /\.from\(/);
    assert.doesNotMatch(src, /insert\(/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /innerHTML|document\./);
    assert.doesNotMatch(src, /registerScreen/);
  });

  it("cache hors persist / localStorage", () => {
    const state = read("js/core/state.js");
    assert.doesNotMatch(state, /recentPeersState|lobby_encounters|setRecentLobbyPeers/);
    const fs = read("js/core/recentPeersState.js");
    assert.doesNotMatch(fs, /localStorage/);
    assert.doesNotMatch(fs, /scheduleSave/);
    assert.equal(isRegisteredUser({ loggedIn: true, isGuest: true }), false);
  });

  it("normalise RPC + re-filtre ami / salon commun", () => {
    assert.equal(normalizeRecentPeerRow({ display_name: "Léa" }), null);
    const row = normalizeRecentPeerRow({
      user_id: "b",
      display_name: "Léa",
      emoji: "🦊",
    });
    assert.equal(row.userId, "b");
    assert.equal(row.name, "Léa");
    assert.equal(row.lastSharedAt, null);
    assert.equal(
      recentPeerKeepListed(row, { localIsRegistered: true }),
      true
    );
    assert.equal(
      recentPeerKeepListed(row, { localIsRegistered: false }),
      false
    );
    assert.equal(
      recentPeerKeepListed(row, {
        localIsRegistered: true,
        alreadyFriends: true,
      }),
      false
    );
    assert.equal(
      recentPeerKeepListed(row, {
        localIsRegistered: true,
        currentlyInSameLobby: true,
      }),
      false
    );
  });

  it("overlay graphe → + Ami / Annuler / Accepter ; jamais Inviter", () => {
    const friends = [{ userId: "f" }];
    const incoming = [{ fromUserId: "i" }];
    const outgoing = [{ toUserId: "o" }];
    const graph = { friends, incoming, outgoing };
    assert.equal(overlayStatusForRecentPeer("x", graph), FRIEND_OVERLAY.none);
    assert.equal(overlayStatusForRecentPeer("f", graph), FRIEND_OVERLAY.friends);
    assert.equal(overlayStatusForRecentPeer("i", graph), FRIEND_OVERLAY.pendingIn);
    assert.equal(overlayStatusForRecentPeer("o", graph), FRIEND_OVERLAY.pendingOut);
    const opts = { localIsRegistered: true };
    assert.equal(
      recentPeerAction(overlayStatusForRecentPeer("x", graph), opts),
      RECENT_PEER_ACTION.add
    );
    assert.equal(
      recentPeerAction(overlayStatusForRecentPeer("o", graph), opts),
      RECENT_PEER_ACTION.cancel
    );
    assert.equal(
      recentPeerAction(overlayStatusForRecentPeer("i", graph), opts),
      RECENT_PEER_ACTION.accept
    );
    assert.equal(
      recentPeerAction(overlayStatusForRecentPeer("f", graph), opts),
      RECENT_PEER_ACTION.omit
    );
    assert.equal(RECENT_PEER_ACTION.invite, undefined);
  });

  it("setRecentLobbyPeers + clearRecentPeersCache", () => {
    setRecentLobbyPeers([{ user_id: "b", display_name: "Léa", emoji: "🦊" }]);
    assert.equal(getRecentLobbyPeers().length, 1);
    assert.equal(getRecentLobbyPeers()[0].userId, "b");
    clearRecentPeersCache();
    assert.equal(getRecentLobbyPeers().length, 0);
  });

  it("catch-up HTTP ; pas de Realtime lobby_encounters", () => {
    assert.deepEqual(recentPeersCatchupPlan(), { list: true });
    const rt = read("js/core/friendsRealtime.js");
    assert.match(rt, /fetchRecentLobbyPeers/);
    assert.match(rt, /recentPeersCatchupPlan/);
    assert.match(rt, /clearRecentPeersCache/);
    assert.doesNotMatch(rt, new RegExp(RECENT_PEERS_TABLE));
  });
});
