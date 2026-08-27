/**
 * FEATURE-FRIENDS-03 Palier 0 — contrats Annuler une demande envoyée.
 * Pas d’UI, pas de SQL : palier 1 = feature-friends-03.sql.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIENDS_03_FEATURE_ID,
  FRIENDS_FEATURE_ID,
  FRIEND_CANCEL_RPC_ERROR,
  FRIEND_LABEL,
  FRIEND_OVERLAY,
  FRIEND_ROSTER_ACTION,
  FRIEND_RPC,
  FRIEND_RPC_ERROR,
  FRIEND_RPC_F03,
  cancelFriendRequestAppliesCooldown,
  rosterActionFromOverlay,
} from "../js/config/friends.js";
import { rosterLabelFromAction } from "../js/core/friendsLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const friendsDoc = readFileSync(join(ROOT, "docs/FRIENDS.md"), "utf8");
const configSrc = readFileSync(join(ROOT, "js/config/friends.js"), "utf8");

describe("FEATURE-FRIENDS-03 Palier 0 — contrats Annuler", () => {
  it("vague dédiée, mêmes tables, pas de fetch / DOM / chat lobby", () => {
    assert.equal(FRIENDS_03_FEATURE_ID, "FEATURE-FRIENDS-03");
    assert.notEqual(FRIENDS_FEATURE_ID, FRIENDS_03_FEATURE_ID);
    assert.match(configSrc, /FEATURE-FRIENDS-03/);
    assert.doesNotMatch(configSrc, /from\(["']lobby_members["']/);
    assert.doesNotMatch(configSrc, /\bfetch\s*\(/);
    assert.doesNotMatch(configSrc, /document\./);
    assert.doesNotMatch(configSrc, /lobby_messages/);
  });

  it("RPC cancel + listOutgoing ; erreurs F01 ; pas de cooldown ; no-op sans code métier", () => {
    assert.deepEqual(FRIEND_RPC_F03, {
      cancel: "cancel_friend_request",
      listOutgoing: "list_outgoing_friend_requests",
    });
    assert.equal(FRIEND_RPC.cancel, "cancel_friend_request");
    assert.equal(FRIEND_RPC.listOutgoing, "list_outgoing_friend_requests");
    assert.equal(FRIEND_CANCEL_RPC_ERROR.guest, FRIEND_RPC_ERROR.guest);
    assert.equal(FRIEND_CANCEL_RPC_ERROR.self, FRIEND_RPC_ERROR.self);
    assert.equal(FRIEND_CANCEL_RPC_ERROR.notFound, FRIEND_RPC_ERROR.notFound);
    assert.equal(cancelFriendRequestAppliesCooldown(), false);
    assert.equal(FRIEND_CANCEL_RPC_ERROR.cooldown, undefined);
    assert.doesNotMatch(configSrc, /friends_cancel/);
  });

  it("copy Annuler ≠ Retirer ; section Demandes envoyées", () => {
    assert.equal(FRIEND_LABEL.cancelRequest, "Annuler");
    assert.equal(FRIEND_LABEL.unfriend, "Retirer");
    assert.notEqual(FRIEND_LABEL.cancelRequest, FRIEND_LABEL.unfriend);
    assert.equal(FRIEND_LABEL.outgoingSection, "Demandes envoyées");
    assert.equal(FRIEND_LABEL.outgoingEmpty, "Aucune demande envoyée.");
    assert.equal(FRIEND_LABEL.sent, "Envoyée");
  });

  it("roster : pending_out = Annuler (palier 3)", () => {
    assert.equal(FRIEND_ROSTER_ACTION.cancel, "cancel");
    assert.equal(
      rosterActionFromOverlay(FRIEND_OVERLAY.pendingOut, { localIsRegistered: true }),
      FRIEND_ROSTER_ACTION.cancel
    );
    assert.equal(rosterLabelFromAction(FRIEND_ROSTER_ACTION.sent), "Envoyée");
    assert.equal(rosterLabelFromAction(FRIEND_ROSTER_ACTION.cancel), "Annuler");
  });

  it("docs/FRIENDS.md nomme FEATURE-FRIENDS-03 et les RPC", () => {
    assert.match(friendsDoc, /FEATURE-FRIENDS-03/);
    assert.match(friendsDoc, /cancel_friend_request/);
    assert.match(friendsDoc, /list_outgoing_friend_requests/);
    assert.match(friendsDoc, /Demandes envoyées/);
    assert.match(friendsDoc, /Pas de cooldown/);
    assert.match(friendsDoc, /Silencieux pour le destinataire/);
  });
});
