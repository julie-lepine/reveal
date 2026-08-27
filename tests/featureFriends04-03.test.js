/**
 * FEATURE-FRIENDS-04 Palier 3 — UI page Amis « Vous venez de jouer avec ».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FRIEND_LABEL } from "../js/config/friends.js";
import { LOBBY_INVITE_LABEL } from "../js/config/lobbyInvites.js";
import {
  RECENT_PEER_ACTION,
  RECENT_PEERS_LABEL,
} from "../js/config/recentPeers.js";
import { recentPeerRowAction } from "../js/core/recentPeersLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-04 Palier 3 — UI croisés", () => {
  it("lignes : + Ami / Annuler / Accepter ; omit ami et salon commun ; pas Inviter", () => {
    const graph = {
      friends: [{ userId: "f" }],
      incoming: [{ fromUserId: "i" }],
      outgoing: [{ toUserId: "o" }],
    };
    const listed = { localIsRegistered: true, currentlyInSameLobby: false };
    assert.equal(recentPeerRowAction("x", graph, listed), RECENT_PEER_ACTION.add);
    assert.equal(recentPeerRowAction("o", graph, listed), RECENT_PEER_ACTION.cancel);
    assert.equal(recentPeerRowAction("i", graph, listed), RECENT_PEER_ACTION.accept);
    assert.equal(recentPeerRowAction("f", graph, listed), RECENT_PEER_ACTION.omit);
    assert.equal(
      recentPeerRowAction("x", graph, { ...listed, currentlyInSameLobby: true }),
      RECENT_PEER_ACTION.omit
    );
    assert.equal(RECENT_PEER_ACTION.invite, undefined);
    assert.equal(RECENT_PEERS_LABEL.section, "Vous venez de jouer avec");
    assert.equal(RECENT_PEERS_LABEL.empty, "Personne récemment.");
    assert.equal(FRIEND_LABEL.add, "+ Ami");
    assert.equal(FRIEND_LABEL.cancelRequest, "Annuler");
    assert.equal(FRIEND_LABEL.accept, "Accepter");
    assert.notEqual(FRIEND_LABEL.cancelRequest, LOBBY_INVITE_LABEL.invite);
  });

  it("page Amis : section après demandes, avant Tes amis ; pas de chat", () => {
    const src = read("js/screens/friends.js");
    assert.match(src, /data-recent-peers/);
    assert.match(src, /RECENT_PEERS_LABEL\.section/);
    assert.match(src, /data-recent-peers-empty/);
    assert.match(src, /data-recent-peer-add/);
    assert.match(src, /data-recent-peer-cancel/);
    assert.match(src, /data-recent-peer-accept/);
    assert.match(src, /onAddRecentPeer/);
    assert.match(src, /sendFriendRequest/);
    assert.match(src, /fetchRecentLobbyPeers/);
    assert.match(src, /onRecentPeersCacheUpdated/);
    assert.doesNotMatch(src, /data-recent-peer-invite/);
    const controlFn = src.slice(
      src.indexOf("function recentPeerControlHtml"),
      src.indexOf("function recentPeerRowHtml")
    );
    assert.doesNotMatch(controlFn, /LOBBY_INVITE/);
    assert.doesNotMatch(controlFn, /FRIEND_LABEL\.sent/);
    assert.doesNotMatch(src, /lobby_messages/);
    const outgoingAt = src.indexOf("data-friends-outgoing>");
    const recentAt = src.indexOf("data-recent-peers>");
    const listAt = src.indexOf("data-friends-list>");
    assert.ok(outgoingAt > 0 && recentAt > outgoingAt && listAt > recentAt);
    const guestAt = src.indexOf("function guestPanelHtml");
    const listsAt = src.indexOf("function listsHtml");
    const guestFn = src.slice(guestAt, listsAt);
    assert.doesNotMatch(guestFn, /data-recent-peers/);
  });
});
