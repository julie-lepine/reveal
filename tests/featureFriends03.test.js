/**
 * FEATURE-FRIENDS-01 Palier 3 — Realtime client (pas d’UI).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIENDS_TABLE,
  friendsRealtimeTopic,
} from "../js/config/friends.js";
import {
  friendsCatchupPlan,
  friendsRealtimeChangeSpecs,
} from "../js/core/friendsLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-01 Palier 3 — realtime", () => {
  it("topic friends:uid, jamais lobby:", () => {
    assert.equal(friendsRealtimeTopic("abc"), "friends:abc");
    assert.doesNotMatch(friendsRealtimeTopic("abc"), /^lobby:/);
  });

  it("4 filtres postgres_changes, pas de cooldowns", () => {
    const specs = friendsRealtimeChangeSpecs("u1");
    assert.equal(specs.length, 4);
    assert.deepEqual(
      specs.map((s) => s.table).sort(),
      [
        FRIENDS_TABLE.friendships,
        FRIENDS_TABLE.friendships,
        FRIENDS_TABLE.requests,
        FRIENDS_TABLE.requests,
      ].sort()
    );
    assert.ok(specs.some((s) => s.filter === "to_user_id=eq.u1"));
    assert.ok(specs.some((s) => s.filter === "from_user_id=eq.u1"));
    assert.ok(specs.some((s) => s.filter === "user_a=eq.u1"));
    assert.ok(specs.some((s) => s.filter === "user_b=eq.u1"));
    assert.equal(
      specs.some((s) => s.table === FRIENDS_TABLE.cooldowns),
      false
    );
    assert.deepEqual(friendsRealtimeChangeSpecs(""), []);
  });

  it("catch-up : overlay seulement en lobby ; incoming toujours", () => {
    assert.deepEqual(friendsCatchupPlan({ inLobby: true, lobbyId: "L" }), {
      overlay: true,
      incoming: true,
      friends: true,
    });
    assert.deepEqual(friendsCatchupPlan({ inLobby: false, lobbyId: null }), {
      overlay: false,
      incoming: true,
      friends: true,
    });
  });

  it("friendsRealtime.js : postgres_changes + stop au logout", () => {
    const rt = read("js/core/friendsRealtime.js");
    assert.match(rt, /friendsRealtimeTopic/);
    assert.match(rt, /postgres_changes/);
    assert.match(rt, /removeChannel/);
    assert.match(rt, /fetchLobbyFriendOverlay/);
    assert.match(rt, /fetchIncomingFriendRequests/);
    assert.doesNotMatch(rt, /lobby_messages/);
    assert.doesNotMatch(rt, /lobby:\$\{/);
  });

  it("auth + boot branchent le sync", () => {
    const auth = read("js/core/supabaseAuth.js");
    assert.match(auth, /syncFriendsRealtimeForSession/);
    const main = read("js/main.js");
    assert.match(main, /syncFriendsRealtimeForSession/);
    assert.match(main, /FRIENDS_SCREEN_ID/);
  });
});
