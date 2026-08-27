/**
 * FEATURE-FRIENDS-02 Palier 3 — Realtime invitations sur le canal friends.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOBBY_INVITE_TABLE } from "../js/config/lobbyInvites.js";
import { friendsRealtimeTopic } from "../js/config/friends.js";
import { friendsRealtimeChangeSpecs } from "../js/core/friendsLogic.js";
import {
  lobbyInviteRealtimeChangeSpecs,
  lobbyInvitesCatchupPlan,
} from "../js/core/lobbyInvitesLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-02 Palier 3 — realtime invitations", () => {
  it("même topic friends:uid ; 2 filtres lobby_invites (to + from)", () => {
    assert.equal(friendsRealtimeTopic("u1"), "friends:u1");
    assert.doesNotMatch(friendsRealtimeTopic("u1"), /^lobby:/);
    const specs = lobbyInviteRealtimeChangeSpecs("u1");
    assert.equal(specs.length, 2);
    assert.ok(specs.every((s) => s.table === LOBBY_INVITE_TABLE));
    assert.ok(specs.some((s) => s.filter === "to_user_id=eq.u1"));
    assert.ok(specs.some((s) => s.filter === "from_user_id=eq.u1"));
    assert.deepEqual(lobbyInviteRealtimeChangeSpecs(""), []);
  });

  it("ne remplace pas les 4 filtres amis v1", () => {
    assert.equal(friendsRealtimeChangeSpecs("u1").length, 4);
    assert.equal(
      friendsRealtimeChangeSpecs("u1").some((s) => s.table === LOBBY_INVITE_TABLE),
      false
    );
  });

  it("catch-up invitations : incoming + outgoing toujours", () => {
    assert.deepEqual(lobbyInvitesCatchupPlan(), {
      incoming: true,
      outgoing: true,
    });
  });

  it("friendsRealtime.js : concat specs + fetch invites + clear cache au stop", () => {
    const rt = read("js/core/friendsRealtime.js");
    assert.match(rt, /lobbyInviteRealtimeChangeSpecs/);
    assert.match(rt, /fetchIncomingLobbyInvites/);
    assert.match(rt, /fetchOutgoingLobbyInvites/);
    assert.match(rt, /clearLobbyInvitesCache/);
    assert.match(rt, /friendsRealtimeTopic/);
    assert.doesNotMatch(rt, /lobby:\$\{/);
    assert.doesNotMatch(rt, /lobby_messages/);
  });
});
