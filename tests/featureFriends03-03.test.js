/**
 * FEATURE-FRIENDS-03 Palier 3 — UI Annuler (roster + page Amis).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIEND_LABEL,
  FRIEND_OVERLAY,
  FRIEND_ROSTER_ACTION,
  rosterActionFromOverlay,
} from "../js/config/friends.js";
import { peerFriendRosterKind, rosterLabelFromAction } from "../js/core/friendsLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-03 Palier 3 — UI Annuler", () => {
  it("pending_out → bouton Annuler, pas badge Envoyée", () => {
    const peer = { isLocal: false, userId: "u2", localIsRegistered: true };
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.pendingOut, { localIsRegistered: true }),
      FRIEND_ROSTER_ACTION.cancel
    );
    assert.equal(peerFriendRosterKind(FRIEND_OVERLAY.pendingOut, peer), FRIEND_ROSTER_ACTION.cancel);
    assert.equal(rosterLabelFromAction(FRIEND_ROSTER_ACTION.cancel), "Annuler");
    assert.notEqual(FRIEND_LABEL.cancelRequest, FRIEND_LABEL.unfriend);
    const roster = read("js/core/friendsRosterUi.js");
    assert.match(roster, /data-friend-cancel/);
    assert.match(roster, /FRIEND_ROSTER_ACTION\.cancel/);
    assert.doesNotMatch(roster, /FRIEND_ROSTER_ACTION\.sent/);
  });

  it("lobby + Soirée : Annuler branché, pas de chat ami", () => {
    const lobby = read("js/screens/lobby.js");
    assert.match(lobby, /data-friend-cancel/);
    assert.match(lobby, /cancelLobbyFriendRequest/);
    assert.match(lobby, /handleFriendCancel/);
    assert.doesNotMatch(lobby, /lobby_messages/);
    const actions = read("js/core/lobbyFriendActions.js");
    assert.match(actions, /cancelFriendRequest/);
    const settings = read("js/screens/settings.js");
    assert.match(settings, /onFriendCancel/);
    const dialog = read("js/core/dialog.js");
    assert.match(dialog, /onFriendCancel/);
    const css = read("style.css");
    assert.match(css, /\.participant__friend-btn--cancel\{/);
  });

  it("page Amis : demandes reçues en haut, Demandes envoyées repliées sous Tes amis", () => {
    const src = read("js/screens/friends.js");
    assert.match(src, /data-friends-outgoing/);
    assert.match(src, /FRIEND_LABEL\.outgoingSection/);
    assert.match(src, /data-friend-cancel/);
    assert.match(src, /onCancelOutgoing/);
    assert.match(src, /fetchOutgoingFriendRequests/);
    assert.equal(FRIEND_LABEL.outgoingSection, "Demandes envoyées");
    const page = src.slice(src.indexOf("function listsHtml"));
    const tpl = page.slice(page.lastIndexOf("return `"));
    const incomingAt = tpl.indexOf("${incomingSection}");
    const listAt = tpl.indexOf("data-friends-list>");
    const outgoingAt = tpl.indexOf("${outgoingSection}");
    assert.ok(incomingAt > 0 && listAt > incomingAt && outgoingAt > listAt);
    assert.doesNotMatch(src, /lobby_messages/);
  });
});
