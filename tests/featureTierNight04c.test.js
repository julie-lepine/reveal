/**
 * FEATURE-TIERNIGHT-04C — sync / lock / preserve customLiveTierLists.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, beforeEach, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), unsubscribe: () => {} }),
    },
  },
});

let authUid = "uid-self";
mock.module("../js/core/supabaseAuth.js", {
  namedExports: {
    getSupabaseUserId: () => authUid,
  },
});

let syncActive = false;
mock.module("../js/core/gameSync.js", {
  namedExports: {
    isGameSyncActive: () => syncActive,
    applyRemoteSession: () => {},
  },
});

const {
  createCustomLiveTierListId,
  validateCustomLiveTierList,
  CUSTOM_LIVE_TIER_LIST_ID_PREFIX,
} = await import("../js/core/customLiveTierLists.js");
const {
  stripCustomLiveTierListsFromGenericPatch,
  preserveCustomLiveTierListsInFullStateReplace,
  shouldAcceptRemoteCustomLiveTierListsEmpty,
} = await import("../js/core/customLiveTierListsSyncGuard.js");
const {
  isTierNightLiveCustomPoolWritable,
  isLocalTierNightLiveCustomPoolWritable,
} = await import("../js/core/tierNightLiveCustomPoolLock.js");
const {
  mergeCustomLiveTierLists,
  isCustomLiveTierListOwnedBy,
} = await import("../js/core/sessionMerge.js");
const {
  moderateCustomLiveTierListContent,
  addCustomLiveTierListAndSync,
  deleteCustomLiveTierListAndSync,
} = await import("../js/core/customLiveTierListSession.js");
const { getState, saveStatePatch } = await import("../js/core/state.js");
const { HOT_TAKE_FORBIDDEN_WORDS } = await import("../data/hotTakes.js");

function makeList(n, overrides = {}) {
  return {
    id: `${CUSTOM_LIVE_TIER_LIST_ID_PREFIX}${String(n).padStart(4, "0")}-0000-0000-0000-000000000000`,
    name: `List ${n}`,
    emoji: "🎯",
    items: [`A${n}`, `B${n}`, `C${n}`, `D${n}`],
    author: `Author${n}`,
    authorUid: `uid-${n}`,
    custom: true,
    ...overrides,
  };
}

describe("FEATURE-TIERNIGHT-04C — SQL migration presence", () => {
  it("migration dédiée + RPC names", () => {
    const sql = readFileSync(
      join(root, "supabase/feature-tiernight-04c-custom-live-tier-lists.sql"),
      "utf8"
    );
    assert.match(sql, /upsert_player_custom_live_tier_list/);
    assert.match(sql, /delete_player_custom_live_tier_list/);
    assert.match(sql, /clear_tiernight_custom_live_tier_lists/);
    assert.match(sql, /tiernight_live_custom_pool_writable/);
    assert.match(sql, /TNS_LIVE_CUSTOM_LOCKED/);
    assert.match(sql, /TNS_LIVE_CUSTOM_EDIT_FORBIDDEN/);
    assert.match(sql, /octet_length\(p_entry::text\) > 4096/);
    assert.match(sql, /customLiveTierLists/);
    assert.match(sql, /if not public\.is_lobby_host\(p_lobby_id\)/);
    assert.doesNotMatch(sql, /is_lobby_host\(p_lobby_id,\s*v_uid\)/);
    assert.match(sql, /assert_lobby_member\(p_lobby_id\)/);
    assert.match(sql, /Nom de tier list trop long/);
    assert.match(sql, /Emoji custom live trop long/);
    assert.match(sql, /Flag custom live invalide/);
    // Pas de troncature silencieuse name/emoji
    assert.doesNotMatch(sql, /v_name := left\(trim/);
    assert.doesNotMatch(sql, /v_emoji := left\(trim/);
    assert.doesNotMatch(sql, /create or replace function public\.upsert_player_custom_entry/i);
    assert.doesNotMatch(sql, /```/);
  });

  it("preserve refuse revive live si epoch serveur présent", () => {
    const sql = readFileSync(
      join(root, "supabase/feature-tiernight-04c-custom-live-tier-lists.sql"),
      "utf8"
    );
    assert.match(
      sql,
      /not \(found and \(v_row\.state \? 'customLiveTierListsEpoch'\)\)/
    );
  });

  it("runbook + harness B1/B2 séparés ; zéro %rowtype", () => {
    const runbook = readFileSync(
      join(root, "supabase/feature-tiernight-04c-custom-live-tier-lists-runbook.sql"),
      "utf8"
    );
    const b1 = readFileSync(
      join(root, "supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-bootstrap.sql"),
      "utf8"
    );
    const b2 = readFileSync(
      join(root, "supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-tests.sql"),
      "utf8"
    );
    const stub = readFileSync(
      join(root, "supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-harness.sql"),
      "utf8"
    );
    assert.match(runbook, /B1\) BOOTSTRAP/);
    assert.match(runbook, /B2\) TESTS/);
    assert.match(runbook, /NE PAS RÉEXÉCUTER/);
    assert.match(b1, /TN04C B1 READY/);
    assert.match(b1, /drop table if exists public\.tn04c_smoke_ctx/);
    assert.match(b1, /create table public\.tn04c_smoke_ctx/);
    assert.doesNotMatch(b1, /%rowtype/i);
    assert.doesNotMatch(b1, /^[^-\n]*\bdrop\b[^;\n]*\bcascade\b/im);
    assert.match(b2, /TN04C_B1_REQUIRED/);
    assert.match(b2, /CLEANUP OK/);
    assert.doesNotMatch(b2, /%rowtype/i);
    assert.doesNotMatch(b2, /^[^-\n]*\bdrop\b[^;\n]*\bcascade\b/im);
    assert.match(b2, /c record;/);
    assert.match(stub, /DEPRECATED/);
  });
});

describe("FEATURE-TIERNIGHT-04C — pool lock predicate", () => {
  it("matrice A–J (parité documentée JS)", () => {
    // A aucun état live
    assert.equal(isTierNightLiveCustomPoolWritable({}), true);
    // B prep seulement
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLive: { lobbyStarted: false },
        customLiveTierListsWritable: true,
      }),
      true
    );
    // C/D Ready ignoré
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLivePrep: { ready: { u: false } },
      }),
      true
    );
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLivePrep: { ready: { u: true } },
      }),
      true
    );
    // E writable true
    assert.equal(
      isTierNightLiveCustomPoolWritable({ customLiveTierListsWritable: true }),
      true
    );
    // F writable false
    assert.equal(
      isTierNightLiveCustomPoolWritable({ customLiveTierListsWritable: false }),
      false
    );
    // G series kind live
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        customLiveTierListsWritable: true,
        tierNightLive: { series: { kind: "live" } },
      }),
      false
    );
    // H legacy active
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLive: { lobbyStarted: true, finished: false },
      }),
      false
    );
    // I legacy finished → writable (réouverture mono) ; ne pas confondre avec série moderne absente
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLive: { lobbyStarted: true, finished: true },
      }),
      true
    );
    // J malformé / partiel
    assert.equal(isTierNightLiveCustomPoolWritable(null), true);
    assert.equal(isTierNightLiveCustomPoolWritable({ tierNightLive: "x" }), true);
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLive: { series: "not-object", lobbyStarted: false },
      }),
      true
    );
  });

  it("ouvert par défaut / writable false ferme", () => {
    assert.equal(isTierNightLiveCustomPoolWritable({}), true);
    assert.equal(
      isTierNightLiveCustomPoolWritable({ customLiveTierListsWritable: false }),
      false
    );
  });

  it("série kind:live verrouille", () => {
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLive: { series: { kind: "live", phase: "playing_list" } },
      }),
      false
    );
  });

  it("lobbyStarted mono live verrouille jusqu'à finished", () => {
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLive: { lobbyStarted: true, finished: false },
      }),
      false
    );
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLive: { lobbyStarted: true, finished: true },
      }),
      true
    );
  });

  it("Ready n'est pas un critère", () => {
    assert.equal(
      isTierNightLiveCustomPoolWritable({
        tierNightLivePrep: { ready: { "uid-1": true } },
        customLiveTierListsWritable: true,
      }),
      true
    );
  });

  it("projection locale via tierNightLiveGame", () => {
    assert.equal(
      isLocalTierNightLiveCustomPoolWritable({
        customLiveTierListsWritable: true,
        tierNightLiveGame: { lobbyStarted: true, finished: false },
      }),
      false
    );
  });
});

describe("FEATURE-TIERNIGHT-04C — moderation", () => {
  it("hotTakeModeration pur (pas de CDN)", () => {
    const src = readFileSync(join(root, "js/core/hotTakeModeration.js"), "utf8");
    assert.doesNotMatch(src, /https:/);
    assert.doesNotMatch(src, /from\s+["'].*gameSync/);
    assert.doesNotMatch(src, /from\s+["'].*supabaseClient/);
    assert.match(src, /export function checkHotTakeModeration/);
  });

  it("accepte contenu clean", () => {
    const ok = moderateCustomLiveTierListContent({
      name: "Desserts",
      items: ["Tiramisu", "Brownie", "Crepe", "Mochi"],
    });
    assert.equal(ok.blocked, false);
  });

  it("refuse nom interdit → aucun envoi partiel", () => {
    const bad = HOT_TAKE_FORBIDDEN_WORDS[0];
    const res = moderateCustomLiveTierListContent({
      name: `Liste ${bad}`,
      items: ["A", "B", "C", "D"],
    });
    assert.equal(res.blocked, true);
    assert.equal(res.field, "name");
  });

  it("refuse item N interdit", () => {
    const bad = HOT_TAKE_FORBIDDEN_WORDS[0];
    const res = moderateCustomLiveTierListContent({
      name: "Ok name",
      items: ["A", "B", `x ${bad}`, "D"],
    });
    assert.equal(res.blocked, true);
    assert.equal(res.field, "item");
    assert.equal(res.index, 2);
  });
});

describe("FEATURE-TIERNIGHT-04C — strip / preserve", () => {
  it("clé absente → preserve ; strip retire la clé", () => {
    const { safePayload, stripped } = stripCustomLiveTierListsFromGenericPatch({
      tierNightLive: { lobbyStarted: true },
      customLiveTierLists: [{ id: "x" }],
    });
    assert.equal(stripped, true);
    assert.equal("customLiveTierLists" in safePayload, false);
    assert.ok(safePayload.tierNightLive);

    const absent = stripCustomLiveTierListsFromGenericPatch({ foo: 1 });
    assert.equal(absent.stripped, false);
  });

  it("preserve full replace garde la collection serveur", () => {
    const existing = {
      customLiveTierLists: [makeList(1), makeList(2)],
      customLiveTierListsEpoch: 3,
      customLiveTierListsWritable: false,
    };
    const incoming = { screenish: true, customLiveTierLists: [] };
    const out = preserveCustomLiveTierListsInFullStateReplace(incoming, existing, []);
    assert.equal(out.customLiveTierLists.length, 2);
    assert.equal(out.customLiveTierListsEpoch, 3);
    assert.equal(out.customLiveTierListsWritable, false);
  });

  it("clé absente n'est pas un clear autoritatif", () => {
    assert.equal(
      shouldAcceptRemoteCustomLiveTierListsEmpty(
        { customLiveTierListsEpoch: 1 },
        [makeList(1)],
        1
      ),
      false
    );
  });
});

describe("FEATURE-TIERNIGHT-04C — merge / ownership", () => {
  it("UID-only ownership ; pas de fallback name", () => {
    const a = makeList(1);
    assert.equal(isCustomLiveTierListOwnedBy(a, "Author1", "uid-1"), true);
    assert.equal(isCustomLiveTierListOwnedBy(a, "Author1", "uid-other"), false);
    assert.equal(isCustomLiveTierListOwnedBy(a, "Author1", null), false);
  });

  it("merge remote + optimistic local own", () => {
    const remote = [makeList(1)];
    const localOptimistic = [makeList(1), makeList(2)];
    const merged = mergeCustomLiveTierLists(localOptimistic, remote, "Author2", "uid-2");
    assert.equal(merged.length, 2);
    assert.ok(merged.some((x) => x.id === remote[0].id));
    assert.ok(merged.some((x) => x.id === localOptimistic[1].id));
  });

  it("rollback ciblé : retirer A ne touche pas B", () => {
    const a = makeList(1);
    const b = makeList(2);
    let cur = [a, b];
    cur = cur.filter((x) => x.id !== a.id);
    assert.deepEqual(
      cur.map((x) => x.id),
      [b.id]
    );
  });

  it("duplicate remote events idempotents", () => {
    const remote = [makeList(1), makeList(1)];
    const merged = mergeCustomLiveTierLists([], remote, null, "uid-x");
    assert.equal(merged.filter((x) => x.id === remote[0].id).length, 1);
  });
});

describe("FEATURE-TIERNIGHT-04C — hydrate empty accept", () => {
  it("epoch remote plus récent accepte []", () => {
    assert.equal(
      shouldAcceptRemoteCustomLiveTierListsEmpty(
        { customLiveTierLists: [], customLiveTierListsEpoch: 5 },
        [makeList(1)],
        2
      ),
      true
    );
  });

  it("writable false + empty accepte", () => {
    assert.equal(
      shouldAcceptRemoteCustomLiveTierListsEmpty(
        {
          customLiveTierLists: [],
          customLiveTierListsEpoch: 1,
          customLiveTierListsWritable: false,
        },
        [makeList(1)],
        1
      ),
      true
    );
  });
});

describe("FEATURE-TIERNIGHT-04C — state isolation customTierLists", () => {
  beforeEach(() => {
    saveStatePatch({
      customTierLists: [{ id: "custom-local", name: "Local", items: ["a", "b", "c", "d"] }],
      customLiveTierLists: [],
      customLiveTierListsEpoch: 0,
      customLiveTierListsWritable: true,
      tierNightLiveGame: null,
    });
  });

  it("customTierLists local intact après patch live", () => {
    const before = structuredClone(getState().customTierLists);
    saveStatePatch({
      customLiveTierLists: [makeList(1)],
    });
    assert.deepEqual(getState().customTierLists, before);
    assert.equal(getState().customLiveTierLists.length, 1);
  });

  it("validate 04B toujours OK", () => {
    const id = createCustomLiveTierListId();
    const res = validateCustomLiveTierList({
      ...makeList(9),
      id,
      authorUid: "uid-9",
    });
    assert.equal(res.ok, true);
  });

  it("pas de plafond count dans state", () => {
    const many = Array.from({ length: 15 }, (_, i) => makeList(i + 1));
    saveStatePatch({ customLiveTierLists: many });
    assert.equal(getState().customLiveTierLists.length, 15);
  });
});

describe("FEATURE-TIERNIGHT-04C — optimistic create/delete", () => {
  beforeEach(() => {
    authUid = "uid-self";
    syncActive = false;
    saveStatePatch({
      customLiveTierLists: [],
      customLiveTierListsWritable: true,
      tierNightLiveGame: null,
      lobby: null,
      localPlayerName: "Self",
    });
  });

  it("optimistic create success (offline)", async () => {
    const res = await addCustomLiveTierListAndSync({
      name: "Films",
      emoji: "🎬",
      items: ["A", "B", "C", "D"],
    });
    assert.equal(res.ok, true);
    assert.ok(res.id?.startsWith(CUSTOM_LIVE_TIER_LIST_ID_PREFIX));
    assert.equal(getState().customLiveTierLists.length, 1);
    assert.equal(getState().customLiveTierLists[0].authorUid, "uid-self");
  });

  it("create refuse si pool locked", async () => {
    saveStatePatch({ customLiveTierListsWritable: false });
    const res = await addCustomLiveTierListAndSync({
      name: "Films",
      items: ["A", "B", "C", "D"],
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "TNS_LIVE_CUSTOM_LOCKED");
    assert.equal(getState().customLiveTierLists.length, 0);
  });

  it("create refuse moderation sans optimistic", async () => {
    const bad = HOT_TAKE_FORBIDDEN_WORDS[0];
    const res = await addCustomLiveTierListAndSync({
      name: "Ok",
      items: ["A", "B", `x ${bad}`, "D"],
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "MODERATION_BLOCKED");
    assert.equal(getState().customLiveTierLists.length, 0);
  });

  it("create refuse sans auth", async () => {
    authUid = null;
    const res = await addCustomLiveTierListAndSync({
      name: "Films",
      items: ["A", "B", "C", "D"],
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "AUTH_REQUIRED");
  });

  it("optimistic delete success (offline)", async () => {
    const created = await addCustomLiveTierListAndSync({
      name: "Films",
      items: ["A", "B", "C", "D"],
    });
    assert.equal(created.ok, true);
    const res = await deleteCustomLiveTierListAndSync(created.id);
    assert.equal(res.ok, true);
    assert.equal(getState().customLiveTierLists.length, 0);
  });

  it("delete refuse cross-author", async () => {
    saveStatePatch({
      customLiveTierLists: [makeList(1, { authorUid: "uid-other" })],
    });
    const res = await deleteCustomLiveTierListAndSync(makeList(1).id);
    assert.equal(res.ok, false);
    assert.equal(res.code, "TNS_LIVE_CUSTOM_NOT_OWNER");
    assert.equal(getState().customLiveTierLists.length, 1);
  });

  it("ready=true n'empêche pas contribution (offline)", async () => {
    saveStatePatch({
      tierNightLivePrep: { ready: { "uid-self": true } },
      customLiveTierListsWritable: true,
    });
    const res = await addCustomLiveTierListAndSync({
      name: "ReadyOk",
      items: ["A", "B", "C", "D"],
    });
    assert.equal(res.ok, true);
  });
});

describe("FEATURE-TIERNIGHT-04C — session API contract", () => {
  it("create/delete via RPC only ; ready non couplé ; rollback ciblé", () => {
    const src = readFileSync(
      join(root, "js/core/customLiveTierListSession.js"),
      "utf8"
    );
    assert.match(src, /rpcUpsertPlayerCustomLiveTierList/);
    assert.match(src, /rpcDeletePlayerCustomLiveTierList/);
    assert.match(src, /moderateCustomLiveTierListContent/);
    assert.match(src, /isLocalTierNightLiveCustomPoolWritable/);
    assert.doesNotMatch(src, /patchGameState\s*\(/);
    assert.doesNotMatch(src, /\.ready\[/);
    assert.match(src, /removeListById\(cur, list\.id\)/);
    assert.match(src, /restoreListIfMissing/);
  });

  it("gameSync strip live + hydrate merge", () => {
    const sync = readFileSync(join(root, "js/core/gameSync.js"), "utf8");
    assert.match(sync, /stripCustomLiveTierListsFromGenericPatch/);
    assert.match(sync, /preserveCustomLiveTierListsInFullStateReplace/);
    assert.match(sync, /mergeCustomLiveTierLists/);
    assert.match(sync, /customLiveTierLists/);
    assert.match(sync, /customRosterTopics \/ customLiveTierLists volontairement ABSENTS/);
  });

  it("RPC wrappers exportés", async () => {
    const rpc = await import("../js/core/gameSessionRpc.js");
    assert.equal(typeof rpc.rpcUpsertPlayerCustomLiveTierList, "function");
    assert.equal(typeof rpc.rpcDeletePlayerCustomLiveTierList, "function");
    assert.equal(typeof rpc.rpcClearTierNightCustomLiveTierLists, "function");
  });

  it("moderation avant RPC dans le flux create", () => {
    const src = readFileSync(
      join(root, "js/core/customLiveTierListSession.js"),
      "utf8"
    );
    const modIdx = src.indexOf("moderateCustomLiveTierListContent(validated.list)");
    const rpcIdx = src.indexOf("rpcUpsertPlayerCustomLiveTierList");
    assert.ok(modIdx > 0 && rpcIdx > modIdx);
  });
});
