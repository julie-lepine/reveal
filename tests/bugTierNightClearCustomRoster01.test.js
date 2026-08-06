/**
 * FEATURE-TIERNIGHT-03 — clear distant autoritatif customRosterTopics.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            limit: () => ({ data: [], error: null }),
          }),
        }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), unsubscribe: () => {} }),
    },
  },
});

const {
  shouldAcceptRemoteCustomRosterTopicsEmpty,
  applyClearedCustomRosterTopicsFromRpc,
  clearTierNightCustomRosterTopicsAtExitBoundary,
  readLocalCustomRosterWritable,
  __testGetClearCustomRosterLock,
} = await import("../js/core/tierNightCustomRosterClear.js");
const {
  getState,
  saveStatePatch,
  resetEveningState,
  addCustomRosterTopic,
  getCustomRosterTopics,
} = await import("../js/core/state.js");
const { CUSTOM_ROSTER_TOPIC_ID_PREFIX } = await import("../js/core/customRosterTopics.js");

describe("bugTierNightClearCustomRoster01 - contrat SQL / source", () => {
  it("CAS expected session + canonicité JSON + ACL + borne epoch", () => {
    const sql = read("supabase/feature-tiernight-03-clear-custom-roster-topics.sql");
    assert.match(sql, /p_expected_session_id uuid/);
    assert.match(sql, /STALE_SESSION/);
    assert.match(sql, /CUSTOM_ROSTER_EPOCH_EXHAUSTED/);
    assert.match(sql, /2147483647/);
    assert.match(sql, /^\s*begin\s*;/m);
    assert.match(sql, /^\s*commit\s*;/m);
    assert.match(sql, /tiernight_is_custom_roster_clear_canonical/);
    assert.match(sql, /ALREADY_CANONICAL/);
    assert.match(sql, /drop function if exists public\.clear_tiernight_custom_roster_topics\(uuid, boolean\)/);
    assert.doesNotMatch(sql, /finalize_tiernight_series_round/);
  });

  it("préflight lecture seule livré", () => {
    const pre = read(
      "supabase/feature-tiernight-03-clear-custom-roster-topics-preflight.sql"
    );
    assert.match(pre, /pg_get_functiondef/);
    assert.match(pre, /has_tiernight/);
    assert.match(pre, /LEGACY_2ARG|uuid, boolean/);
    assert.match(pre, /Aucune mutation|pas de CREATE/i);
    assert.doesNotMatch(pre, /insert into public\.(lobbies|game_sessions)/i);
  });

  it("harness spawn : 3 acteurs libres, pas de UID partagé", () => {
    const harness = read(
      "supabase/feature-tiernight-03-clear-custom-roster-topics-smoke-harness.sql"
    );
    assert.match(harness, /TNCLR03_NEED_3_FREE_AUTH_USERS/);
    assert.match(harness, /tnclr03_user_has_living_membership/);
    assert.match(harness, /lobby_members_one_living_per_user/);
    assert.match(harness, /other_host_id/);
    assert.match(harness, /v_other_host/);
    assert.match(harness, /TNCLR03_SPAWN_SHARED_UID/);
    assert.match(harness, /attendu 2\/3\/2/);
    assert.doesNotMatch(
      harness,
      /insert into public\.lobby_members[\s\S]{0,400}\(v_other,\s*v_host,/
    );
    assert.match(harness, /\(v_other,\s*v_other_host,/);
    assert.match(harness, /code like 'TNCLR03%'/);
    assert.doesNotMatch(harness, /delete from public\.lobbies\s+where\s+code\s+not like/i);
  });

  it("harness R8 : isolation inter-cas + préconds + pas d’oracle updated_at", () => {
    const harness = read(
      "supabase/feature-tiernight-03-clear-custom-roster-topics-smoke-harness.sql"
    );
    const r8Start = harness.indexOf("-- R8)");
    const r9Start = harness.indexOf("-- R9)");
    assert.ok(r8Start > 0 && r9Start > r8Start);
    const r8 = harness.slice(r8Start, r9Start);
    assert.match(r8, /v_base_preserved/);
    assert.match(r8, /v_base_preserved \|\| v_case/);
    assert.doesNotMatch(r8, /coalesce\(state,\s*'\{\}'::jsonb\)\s*\|\|\s*v_case/);
    assert.match(r8, /précond writable doit être absente/);
    assert.match(r8, /fixture déjà canonique/);
    assert.match(r8, /ctx\.session_id/);
    assert.match(r8, /session courante/);
    assert.doesNotMatch(r8, /v_upd_a\s*>\s*v_upd_b/);
    assert.doesNotMatch(r8, /updated_at\s*=\s*timestamptz/);
    assert.doesNotMatch(r8, /select state,\s*updated_at into/);
    assert.match(r8, /clés hors trio ≠ baseline immuable/);
    assert.match(r8, /CUSTOM_ROSTER_EPOCH_EXHAUSTED/);
  });

  it("harness couvre STALE + canonisation + epoch max", () => {
    const harness = read(
      "supabase/feature-tiernight-03-clear-custom-roster-topics-smoke-harness.sql"
    );
    assert.match(harness, /CUSTOM_ROSTER_EPOCH_EXHAUSTED/);
    assert.match(harness, /2147483647/);
    assert.match(harness, /2147483646/);
    assert.match(harness, /STALE_SESSION/);
  });

  it("wrapper RPC passe expectedSessionId", () => {
    const rpc = read("js/core/gameSessionRpc.js");
    assert.match(rpc, /p_expected_session_id/);
    assert.match(rpc, /expectedSessionId/);
    const clear = read("js/core/tierNightCustomRosterClear.js");
    assert.match(clear, /expectedSessionId:\s*capturedSessionId/);
    assert.match(clear, /CUSTOM_ROSTER_EPOCH_EXHAUSTED/);
  });

  it("chemins sortie appellent la frontière unique", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /await clearTierNightCustomRosterTopicsAtExitBoundary/);
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /clearTierNightCustomRosterTopicsAtExitBoundary/);
  });
});

describe("bugTierNightClearCustomRoster01 - hydrate anti-revive", () => {
  it("epoch remote plus récent accepte []", () => {
    assert.equal(
      shouldAcceptRemoteCustomRosterTopicsEmpty(
        { customRosterTopics: [], customRosterTopicsEpoch: 3 },
        [{ id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`, authorUid: "other" }],
        1
      ),
      true
    );
  });

  it("writable false + [] accepte même epoch égal", () => {
    assert.equal(
      shouldAcceptRemoteCustomRosterTopicsEmpty(
        {
          customRosterTopics: [],
          customRosterTopicsEpoch: 1,
          customRosterTopicsWritable: false,
        },
        [{ id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`, authorUid: "other" }],
        1
      ),
      true
    );
  });
});

describe("bugTierNightClearCustomRoster01 - état local / lock / idempotence", () => {
  beforeEach(() => {
    resetEveningState();
  });
  afterEach(() => {
    resetEveningState();
  });

  it("applyCleared pose [] + epoch + writable", () => {
    assert.equal(addCustomRosterTopic({ name: "Theme A" }).ok, true);
    applyClearedCustomRosterTopicsFromRpc({ epoch: 4, writable: false });
    assert.deepEqual(getCustomRosterTopics(), []);
    assert.equal(getState().customRosterTopicsEpoch, 4);
    assert.equal(getState().customRosterTopicsWritable, false);
  });

  it("offline: premier clear bump ; second identique ALREADY_CANONICAL", async () => {
    assert.equal(addCustomRosterTopic({ name: "Local A" }).ok, true);
    const once = await clearTierNightCustomRosterTopicsAtExitBoundary({
      reopen: false,
    });
    assert.equal(once.ok, true);
    assert.equal(once.applied, true);
    const epoch1 = getState().customRosterTopicsEpoch;
    const twice = await clearTierNightCustomRosterTopicsAtExitBoundary({
      reopen: false,
    });
    assert.equal(twice.applied, false);
    assert.equal(twice.code, "ALREADY_CANONICAL");
    assert.equal(getState().customRosterTopicsEpoch, epoch1);
  });

  it("offline: vide/closed puis reopen mutates ; second reopen no-op", async () => {
    saveStatePatch({
      customRosterTopics: [],
      customRosterTopicsEpoch: 3,
      customRosterTopicsWritable: false,
    });
    const reopen = await clearTierNightCustomRosterTopicsAtExitBoundary({
      reopen: true,
    });
    assert.equal(reopen.applied, true);
    assert.equal(getState().customRosterTopicsEpoch, 4);
    const again = await clearTierNightCustomRosterTopicsAtExitBoundary({
      reopen: true,
    });
    assert.equal(again.applied, false);
    assert.equal(again.code, "ALREADY_CANONICAL");
  });

  it("double-clic logique : second in-flight skipped ou canonical", async () => {
    assert.equal(addCustomRosterTopic({ name: "Theme X" }).ok, true);
    const [ra, rb] = await Promise.all([
      clearTierNightCustomRosterTopicsAtExitBoundary({ reopen: false }),
      clearTierNightCustomRosterTopicsAtExitBoundary({ reopen: false }),
    ]);
    assert.ok([ra, rb].some((o) => o.ok === true));
    assert.ok(
      [ra, rb].some(
        (o) =>
          o.skipped === true ||
          o.code === "ALREADY_CANONICAL" ||
          o.code === "IN_FLIGHT" ||
          o.applied === false
      )
    );
    assert.equal(getCustomRosterTopics().length, 0);
  });

  it("anti-double lock exposé", () => {
    assert.equal(typeof __testGetClearCustomRosterLock().run, "function");
  });

  it("Rank Live + consumed préservés après clear local", () => {
    saveStatePatch({
      customTierLists: [{ id: "live-1", name: "L", items: ["a", "b"] }],
      consumedCustomRosterTopicIds: ["roster:custom-used"],
    });
    assert.equal(addCustomRosterTopic({ name: "Temp" }).ok, true);
    applyClearedCustomRosterTopicsFromRpc({ epoch: 2, writable: false });
    assert.equal(getState().customTierLists[0].id, "live-1");
    assert.deepEqual(getState().consumedCustomRosterTopicIds, ["roster:custom-used"]);
  });

  it("writable legacy absent = ouvert en lecture", () => {
    assert.equal(readLocalCustomRosterWritable({ customRosterTopicsWritable: undefined }), true);
    assert.equal(readLocalCustomRosterWritable({ customRosterTopicsWritable: false }), false);
  });
});

describe("bugTierNightClearCustomRoster01 - autorité + stale client", () => {
  it("hôte réel ; STALE_SESSION serveur documenté", () => {
    const clear = read("js/core/tierNightCustomRosterClear.js");
    assert.match(clear, /isLobbyHost\(\)/);
    assert.match(clear, /STALE_SESSION/);
    assert.match(clear, /STALE_LOBBY/);
    assert.doesNotMatch(clear, /canActAsHost/);
    const sql = read("supabase/feature-tiernight-03-clear-custom-roster-topics.sql");
    assert.match(sql, /is_lobby_host/);
    assert.match(sql, /v_row\.id is distinct from p_expected_session_id/);
  });
});
