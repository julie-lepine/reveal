/**
 * FEATURE-FRIENDS-01 Palier 7 — unfriend (Retirer), silencieux pour l’autre.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FRIEND_LABEL } from "../js/config/friends.js";
import { unfriendConfirmCopy } from "../js/core/friendsLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-01 Palier 7 — unfriend", () => {
  it("copy : Retirer + confirm locale, pas de notif chez l’autre", () => {
    assert.equal(FRIEND_LABEL.unfriend, "Retirer");
    assert.equal(FRIEND_LABEL.unfriendCancel, "Annuler");
    const copy = unfriendConfirmCopy("Ada");
    assert.match(copy.message, /Ada/);
    assert.equal(copy.confirmLabel, "Retirer");
    assert.equal(copy.cancelLabel, "Annuler");
    assert.equal(unfriendConfirmCopy("").message.includes("ce joueur"), true);
  });

  it("page Amis : bouton Retirer + confirm avant RPC, pas de chat", () => {
    const src = read("js/screens/friends.js");
    assert.match(src, /data-friend-unfriend/);
    assert.match(src, /unfriendUser/);
    assert.match(src, /showAppConfirm/);
    assert.match(src, /unfriendConfirmCopy/);
    assert.match(src, /FRIEND_OVERLAY\.none/);
    assert.doesNotMatch(src, /t['’]a retiré/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /addLobbyMessage/);
  });

  it("notice incoming ne notifie pas un unfriend", () => {
    const notice = read("js/core/friendRequestNotice.js");
    assert.doesNotMatch(notice, /unfriendUser/);
    assert.doesNotMatch(notice, /t['’]a retiré/);
  });

  it("RPC unfriend déjà branché ; catch-up liste + overlay", () => {
    const rpc = read("js/core/supabaseFriends.js");
    assert.match(rpc, /export async function unfriendUser/);
    assert.match(rpc, /FRIEND_RPC\.unfriend/);
    const rt = read("js/core/friendsRealtime.js");
    assert.match(rt, /fetchMyFriends/);
    assert.match(rt, /fetchLobbyFriendOverlay/);
  });
});
