/**
 * FEATURE-TIERNIGHT-04E — launch atomique Rank Live (proposition client).
 * Architecture : catalogue = TIER_LISTS JS ; serveur = commit + customs match.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it, beforeEach, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: { rpc: async () => ({ data: null, error: null }) },
  },
});
mock.module("../js/core/supabaseAuth.js", {
  namedExports: { getSupabaseUserId: () => "uid-host" },
});
mock.module("../js/core/players.js", {
  namedExports: {
    getActivePlayerNames: () => ["Host", "Guest"],
    getActivePlayers: () => [
      { name: "Host", userId: "uid-host", isLocal: true },
      { name: "Guest", userId: "uid-guest", isLocal: false },
    ],
  },
});
mock.module("../js/core/gameSync.js", {
  namedExports: {
    isGameSyncActive: () => false,
    isLobbyHost: () => true,
    canActAsHost: () => true,
    allMembersReady: () => true,
    patchGameState: async () => ({}),
    tierNightPrepToRemote: (s) => s,
    tierNightPrepFromRemote: (r) => r || {},
    applyRemoteSession: () => {},
    refreshGameSession: async () => null,
    getCachedGameSession: () => null,
    requireLocalParticipantUid: () => "uid-host",
  },
});
mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    commitPrepReadyToggle: async () => {},
    navigateAfterGameLaunch: () => {},
    prepGuestFollowOnSession: () => () => false,
    runPrepGameLaunch: async ({ launch }) => launch(),
  },
});
mock.module("../js/core/router.js", {
  namedExports: {
    navigate: () => {},
    getScreenParams: () => ({}),
    getNavStack: () => [],
  },
});
mock.module("../js/core/lobby.js", {
  namedExports: {
    getLobbyParticipants: () => [
      { name: "Host", userId: "uid-host" },
      { name: "Guest", userId: "uid-guest" },
    ],
    setLobbyPlaying: async () => {},
    hasActiveLobby: () => true,
  },
});

const { TIER_LISTS } = await import("../data/tierTopics.js");
const {
  buildTierNightLiveSeriesListSubset,
  getTierNightLiveOfficialPool,
  TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS,
} = await import("../js/core/tierNightLiveSeriesDomain.js");
const {
  buildTierNightLiveSeriesWire,
  buildTierNightLiveSeriesLaunchState,
  prepareTierNightLiveSeriesLaunch,
  validateTierNightLiveSeriesShape,
  validateTierNightLiveSeriesShapeStrict,
  validateTierNightLiveCustomQueuePolicy,
  parseTierNightLiveJsonInt,
  projectTierNightLiveSeriesRound0,
  mapTierNightLiveLaunchError,
  snapshotLiveTierListForSeries,
  customLiveSnapshotMatchesCanon,
  obtainTierNightLiveLaunchAttempt,
  clearInFlightTierNightLiveLaunchAttempt,
  getInFlightTierNightLiveLaunchAttempt,
} = await import("../js/core/tierNightLiveSeriesLaunch.js");
const { CUSTOM_LIVE_TIER_LIST_ID_PREFIX } = await import("../js/core/customLiveTierLists.js");
const { getState, saveStatePatch } = await import("../js/core/state.js");
const {
  markTierNightLiveSeriesPrepStarted,
  validateTierNightLivePrepForLaunch,
} = await import("../js/core/tierNightLivePrepSession.js");
const { isLocalTierNightLiveCustomPoolWritable } = await import(
  "../js/core/tierNightLiveCustomPoolLock.js"
);

function makeCustom(n, overrides = {}) {
  return {
    id: `${CUSTOM_LIVE_TIER_LIST_ID_PREFIX}${String(n).padStart(4, "0")}-0000-0000-0000-000000000000`,
    name: `Custom ${n}`,
    emoji: "🎯",
    items: Array.from({ length: 4 }, (_, i) => `C${n}-${i}`),
    author: `Author${n}`,
    authorUid: `uid-${n}`,
    custom: true,
    ...overrides,
  };
}

function seqRng(values) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

beforeEach(() => {
  clearInFlightTierNightLiveLaunchAttempt();
  saveStatePatch({
    tierNightLiveSeriesPrep: {
      categoryIds: ["*"],
      roundCount: 5,
      ready: {},
      setupEpoch: 1,
    },
    customLiveTierLists: [],
    customLiveTierListsWritable: true,
    tierNightLiveGame: {
      runId: null,
      lobbyStarted: false,
      finished: false,
    },
  });
});

describe("FEATURE-TIERNIGHT-04E — wiring", () => {
  it("SQL migration + package + doc + RPC client p_series", () => {
    const sql = read("supabase/feature-tiernight-04e-start-live-series.sql");
    assert.ok(sql.includes("start_tiernight_live_series"));
    assert.match(sql, /p_series\s+jsonb/);
    assert.ok(read("package.json").includes("featureTierNight04e.test.js"));
    assert.ok(read("docs/FEATURE-TIERNIGHT-04E.md").includes("TIER_LISTS"));
    assert.match(read("js/core/gameSessionRpc.js"), /p_series:\s*series/);
  });

  it("stub 04D retiré ; pas de mono launcher", () => {
    const prep = read("js/screens/tierNightLivePrep.js");
    assert.match(prep, /validateTierNightLivePrepForLaunch/);
    assert.doesNotMatch(prep, /TNS_LIVE_LAUNCH_PENDING_04E/);
    assert.doesNotMatch(prep, /markTierNightLiveLobbyStarted/);
    const session = read("js/core/tierNightLivePrepSession.js");
    assert.match(session, /rpcStartTierNightLiveSeries/);
    assert.match(session, /obtainTierNightLiveLaunchAttempt|prepareTierNightLiveSeriesLaunch/);
    assert.doesNotMatch(session, /markTierNightLiveLobbyStarted/);
  });
});

describe("FEATURE-TIERNIGHT-04E — builder client (04B)", () => {
  for (const n of TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS) {
    it(`${n} officielles → queue exacte`, () => {
      const built = buildTierNightLiveSeriesLaunchState({
        roundCount: n,
        customLists: [],
        random: seqRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
        deckRandom: () => 0.2,
      });
      assert.equal(built.ok, true);
      assert.equal(built.series.roundCount, n);
      assert.equal(built.series.queue.length, n);
      assert.equal(built.series.phase, "playing_list");
      assert.equal(built.series.roundIndex, 0);
      assert.equal(built.series.kind, "live");
      assert.deepEqual(built.series.completedRoundIds, []);
      assert.deepEqual(built.series.scoredRoundIds, []);
    });
  }

  it("C=0 → officiels seulement", () => {
    const subset = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      customLists: [],
      random: () => 0.3,
    });
    assert.equal(subset.ok, true);
    assert.ok(subset.lists.every((l) => l.custom === false));
  });

  it("0<C<N → toutes customs + complément officiel", () => {
    const customs = [makeCustom(1), makeCustom(2)];
    const subset = buildTierNightLiveSeriesListSubset({
      roundCount: 5,
      customLists: customs,
      random: () => 0.4,
    });
    assert.equal(subset.ok, true);
    assert.equal(subset.lists.filter((l) => l.custom).length, 2);
    assert.equal(subset.lists.filter((l) => !l.custom).length, 3);
  });

  it("C=N → toutes customs", () => {
    const customs = [makeCustom(1), makeCustom(2), makeCustom(3)];
    const subset = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      customLists: customs,
      random: () => 0.1,
    });
    assert.equal(subset.ok, true);
    assert.ok(subset.lists.every((l) => l.custom === true));
  });

  it("C>N → exactement N customs", () => {
    const customs = [makeCustom(1), makeCustom(2), makeCustom(3), makeCustom(4), makeCustom(5)];
    const subset = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      customLists: customs,
      random: () => 0.2,
    });
    assert.equal(subset.ok, true);
    assert.equal(subset.lists.length, 3);
    assert.ok(subset.lists.every((l) => l.custom === true));
  });

  it("inputs non mutés", () => {
    const customs = [makeCustom(1), makeCustom(2)];
    const before = structuredClone(customs);
    const officials = getTierNightLiveOfficialPool().slice(0, 5);
    const officialsBefore = structuredClone(officials);
    buildTierNightLiveSeriesListSubset({
      roundCount: 5,
      customLists: customs,
      officialLists: officials,
      random: () => 0.5,
    });
    assert.deepEqual(customs, before);
    assert.deepEqual(officials, officialsBefore);
  });

  it("nouvelle official runtime utilisable SANS SQL", () => {
    const injected = {
      id: "new-test-list",
      name: "Nouvelle liste test",
      emoji: "🧪",
      items: ["A", "B", "C", "D"],
      custom: false,
    };
    const pool = [
      injected,
      {
        id: "official-a",
        name: "Off A",
        emoji: "1",
        items: ["a1", "a2", "a3", "a4"],
        custom: false,
      },
      {
        id: "official-b",
        name: "Off B",
        emoji: "2",
        items: ["b1", "b2", "b3", "b4"],
        custom: false,
      },
    ];
    const subset = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      customLists: [],
      officialLists: pool,
      random: () => 0.5,
    });
    assert.equal(subset.ok, true);
    assert.equal(subset.lists.length, 3);
    assert.ok(subset.lists.some((l) => l.id === "new-test-list"));
    const prepared = prepareTierNightLiveSeriesLaunch({
      prep: { roundCount: 3, setupEpoch: 1 },
      officialLists: pool,
      customLists: [],
      runId: "run-new-list",
      random: () => 0.5,
    });
    assert.equal(prepared.ok, true);
    assert.ok(prepared.series.queue.some((q) => q.listId === "new-test-list"));
    const sql = read("supabase/feature-tiernight-04e-start-live-series.sql");
    assert.doesNotMatch(sql, /new-test-list/);
    assert.doesNotMatch(sql, /Nouvelle liste test/);
  });

  it("insufficient → refus avant RPC", () => {
    const officials = getTierNightLiveOfficialPool().slice(0, 1);
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 5,
      officialLists: officials,
      customLists: [],
    });
    assert.equal(built.ok, false);
    assert.equal(built.code, "TNS_LIVE_INSUFFICIENT_TIER_LISTS");
  });
});

describe("FEATURE-TIERNIGHT-04E — prepare / proposal", () => {
  it("prepareTierNightLiveSeriesLaunch : runId + roundIds + snapshots", () => {
    const prep = prepareTierNightLiveSeriesLaunch({
      prep: { roundCount: 5, setupEpoch: 7 },
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [makeCustom(1)],
      runId: "run-prep-01",
      random: () => 0.3,
    });
    assert.equal(prep.ok, true);
    assert.equal(prep.setupEpoch, 7);
    assert.equal(prep.runId, "run-prep-01");
    assert.equal(prep.series.runId, "run-prep-01");
    assert.deepEqual(
      prep.series.queue.map((q) => q.roundId),
      ["run-prep-01:0", "run-prep-01:1", "run-prep-01:2", "run-prep-01:3", "run-prep-01:4"]
    );
    const custom = prep.series.queue.find((q) => q.listSnapshot.custom);
    assert.ok(custom);
    assert.equal(custom.listSnapshot.custom, true);
    assert.equal(custom.listSnapshot.authorUid, "uid-1");
    const official = prep.series.queue.find((q) => !q.listSnapshot.custom);
    assert.equal(official.listSnapshot.custom, false);
  });

  it("snapshot mutation source ≠ snapshot", () => {
    const custom = makeCustom(1, { name: "Origine" });
    const prep = prepareTierNightLiveSeriesLaunch({
      prep: { roundCount: 3, setupEpoch: 1 },
      customLists: [custom],
      random: () => 0.5,
    });
    const entry = prep.series.queue.find((q) => q.listSnapshot.custom);
    custom.name = "Muté";
    custom.items.push("HACK");
    assert.equal(entry.listSnapshot.name, "Origine");
    assert.equal(entry.listSnapshot.items.includes("HACK"), false);
  });

  it("duplicate listId rejeté par shape", () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 3,
      random: () => 0.1,
      deckRandom: () => 0.1,
    });
    const bad = structuredClone(built.series);
    bad.queue[1].listId = bad.queue[0].listId;
    bad.queue[1].listSnapshot = structuredClone(bad.queue[0].listSnapshot);
    assert.equal(validateTierNightLiveSeriesShape(bad).ok, false);
    assert.match(String(validateTierNightLiveSeriesShape(bad).message), /listId/);
  });

  it("duplicate roundId rejeté", () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 3,
      runId: "r1",
      random: () => 0.1,
      deckRandom: () => 0.1,
    });
    const bad = structuredClone(built.series);
    bad.queue[1].roundId = "r1:0";
    assert.equal(validateTierNightLiveSeriesShape(bad).ok, false);
  });
});

describe("FEATURE-TIERNIGHT-04E — custom snapshot ↔ canon", () => {
  it("exact match accepté", () => {
    const c = makeCustom(2);
    const snap = snapshotLiveTierListForSeries(c);
    assert.equal(customLiveSnapshotMatchesCanon(snap, c), true);
  });

  it("items modifiés → mismatch", () => {
    const c = makeCustom(2);
    const snap = snapshotLiveTierListForSeries(c);
    snap.items = [...snap.items, "EXTRA"];
    assert.equal(customLiveSnapshotMatchesCanon(snap, c), false);
  });

  it("authorUid mismatch → reject", () => {
    const c = makeCustom(2);
    const snap = snapshotLiveTierListForSeries(c);
    snap.authorUid = "other";
    assert.equal(customLiveSnapshotMatchesCanon(snap, c), false);
  });
});

describe("FEATURE-TIERNIGHT-04E — attempt / double-click / idempotence client", () => {
  it("double obtain même setupEpoch → même runId (pas 2e shuffle)", () => {
    const prep = { roundCount: 3, setupEpoch: 9 };
    const a = obtainTierNightLiveLaunchAttempt({
      prep,
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: seqRng([0.9, 0.1, 0.2, 0.3]),
    });
    const b = obtainTierNightLiveLaunchAttempt({
      prep,
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: seqRng([0.01, 0.99, 0.5]),
    });
    assert.equal(a.ok && b.ok, true);
    assert.equal(a.runId, b.runId);
    assert.deepEqual(a.series.queue.map((q) => q.listId), b.series.queue.map((q) => q.listId));
    assert.equal(getInFlightTierNightLiveLaunchAttempt()?.runId, a.runId);
  });

  it("setupEpoch change → nouvelle tentative", () => {
    const a = obtainTierNightLiveLaunchAttempt({
      prep: { roundCount: 3, setupEpoch: 1 },
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: () => 0.4,
    });
    const b = obtainTierNightLiveLaunchAttempt({
      prep: { roundCount: 3, setupEpoch: 2 },
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: () => 0.4,
    });
    assert.notEqual(a.runId, b.runId);
  });
});

describe("FEATURE-TIERNIGHT-04E — projection + writable + solo", () => {
  it("projection round 0 = queue[0] ; writable false", () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 3,
      random: () => 0.2,
      deckRandom: () => 0.7,
    });
    assert.equal(built.live.topicId, built.series.queue[0].listSnapshot.id);
    assert.equal(built.live.listName, built.series.queue[0].listSnapshot.name);
    assert.equal(built.live.phase, "voting");
    assert.equal(built.live.roundIdx, 0);
    assert.equal(built.live.lobbyStarted, true);
    assert.deepEqual(
      [...built.live.deck].sort(),
      [...built.series.queue[0].listSnapshot.items].sort()
    );
    assert.equal(built.customLiveTierListsWritable, false);
  });

  it("solo markStarted lock writable ; customs conservées", async () => {
    saveStatePatch({
      customLiveTierLists: [makeCustom(1)],
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 3,
        ready: {},
        setupEpoch: 2,
      },
    });
    const res = await markTierNightLiveSeriesPrepStarted();
    assert.equal(res.ok, true);
    assert.equal(getState().customLiveTierListsWritable, false);
    assert.equal(getState().customLiveTierLists.length, 1);
    assert.equal(getState().tierNightLiveGame.series.kind, "live");
    assert.equal(
      isLocalTierNightLiveCustomPoolWritable({
        customLiveTierListsWritable: getState().customLiveTierListsWritable,
        tierNightLiveGame: getState().tierNightLiveGame,
      }),
      false
    );
  });
});

describe("FEATURE-TIERNIGHT-04E — SQL contrat (source)", () => {
  const sql = () => read("supabase/feature-tiernight-04e-start-live-series.sql");
  const guestSql = () => read("supabase/feature-tiernight-04e-live-prep-guest-ready.sql");

  it("pas de catalogue officiel / builder subset ; C/N + anti-bypass", () => {
    const s = sql();
    assert.doesNotMatch(s, /create or replace function public\.tiernight_live_official_catalog/);
    assert.doesNotMatch(s, /create or replace function public\.tiernight_live_build_list_subset/);
    assert.match(s, /drop function if exists public\.tiernight_live_official_catalog/);
    assert.match(s, /tiernight_live_validate_custom_queue_policy/);
    assert.match(s, /TNS_LIVE_CUSTOM_POOL_STALE/);
    assert.match(s, /TNS_LIVE_CUSTOM_SNAPSHOT_MISMATCH/);
    assert.match(s, /TNS_LIVE_PREP_STALE/);
    assert.match(s, /TNS_LIVE_ALREADY_STARTED/);
    assert.match(s, /custom_flag_prefix|custom-live-/);
    assert.match(s, /tiernight_live_jsonb_int/);
    assert.match(s, /customLiveTierListsWritable',\s*false/);
    assert.match(s, /for update/i);
    assert.match(s, /playing_list/);
    assert.match(s, /tiernight_live_custom_snapshot_matches_canon/);
    assert.doesNotMatch(s, /between_lists/);
    assert.doesNotMatch(s, /series_end/);
  });

  it("harness A split A1/A2 + B split B1/B2 ; namespaces disjoints TN04EA ⊥ TN04EB", () => {
    const a1 = read("supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql");
    const a2 = read("supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql");
    const aStub = read("supabase/feature-tiernight-04e-start-live-series-smoke-harness.sql");
    const aCleanup = read("supabase/feature-tiernight-04e-start-live-series-smoke-cleanup.sql");
    const b1 = read("supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql");
    const b2 = read("supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-tests.sql");
    const bStub = read("supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-harness.sql");
    const bCleanup = read("supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-cleanup.sql");
    assert.match(aStub, /DEPRECATED/);
    assert.match(bStub, /DEPRECATED/);
    assert.match(a1, /TN04EA A1 READY/);
    assert.match(a2, /TN04EA_A1_REQUIRED/);
    assert.match(a2, /TN04EA A2 SUCCESS/);
    assert.match(aCleanup, /TN04EA EMERGENCY CLEANUP|emergency cleanup/i);
    assert.match(b1, /TN04EB B1 READY/);
    assert.match(b2, /TN04EB_B1_REQUIRED/);
    assert.match(b2, /TN04EB B2 SUCCESS/);
    assert.match(bCleanup, /TN04EB EMERGENCY CLEANUP|emergency cleanup/i);
    assert.ok(a1.includes("TN04EA%"));
    assert.ok(b1.includes("TN04EB%"));
    assert.ok(a1.includes("tn04ea_"));
    assert.ok(b1.includes("tn04eb_"));
    const like = (s, pat) => s.startsWith(pat.replace(/%$/, ""));
    assert.equal(like("TN04EAabc", "TN04EB%"), false);
    assert.equal(like("TN04EBabc", "TN04EA%"), false);
    assert.ok(b1.includes("TN04EB_NEED_2_FREE_AUTH_USERS"));
    assert.ok(b1.includes("tn04eb_user_has_living_membership"));
    // A1/B1 keep ctx (no drop after READY); A2/B2 drop only in teardown
    const a1AfterReady = a1.slice(a1.indexOf("TN04EA A1 READY"));
    assert.doesNotMatch(a1AfterReady, /drop table if exists public\.tn04ea_smoke_ctx/i);
    const b1AfterReady = b1.slice(b1.indexOf("TN04EB B1 READY"));
    assert.doesNotMatch(b1AfterReady, /drop table if exists public\.tn04eb_smoke_ctx/i);
    const r17End = a2.indexOf("R18)");
    assert.ok(r17End > 0);
    assert.doesNotMatch(a2.slice(0, r17End), /drop table if exists public\.tn04ea_smoke_ctx/i);
    const kStart = b2.indexOf("K)");
    assert.ok(kStart > 0);
    assert.doesNotMatch(b2.slice(0, kStart), /drop table if exists public\.tn04eb_smoke_ctx/i);
    // Couverture monolithe A–O préservée (J en B1, reste en B2)
    assert.match(b1, /raise notice 'J OK/);
    for (const label of [
      "A\\+F OK",
      "M OK",
      "C OK",
      "N OK",
      "O OK",
      "H OK",
      "B\\+E OK",
      "L OK",
      "D OK",
      "G OK",
      "I OK",
      "K OK",
    ]) {
      assert.match(b2, new RegExp(`raise notice '${label}`));
    }
  });

  it("A1/B1 preuve finale = lecture singleton id=1 ; aucun max/min(uuid)", () => {
    const a1 = read("supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql");
    const a2 = read("supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql");
    const b1 = read("supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql");
    const b2 = read("supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-tests.sql");
    assert.match(
      a1,
      /from public\.tn04ea_smoke_ctx c\s+where c\.id = 1;/
    );
    assert.doesNotMatch(a1, /\bmax\s*\(\s*(lobby_id|session_id|host_id|guest_id|outsider_id)\s*\)/i);
    assert.doesNotMatch(a1, /\bmin\s*\(\s*(lobby_id|session_id|host_id|guest_id|outsider_id)\s*\)/i);
    assert.match(
      a2,
      /from public\.tn04ea_smoke_ctx c\s+where c\.id = 1;/
    );
    assert.doesNotMatch(a2, /\b(max|min)\s*\(\s*(lobby_id|session_id|host_id|guest_id|outsider_id)\s*\)/i);
    assert.match(
      b1,
      /from public\.tn04eb_smoke_ctx c\s+where c\.id = 1;/
    );
    assert.doesNotMatch(b1, /\b(max|min)\s*\(\s*(lobby_id|session_id|host_id|guest_id|outsider_id)\s*\)/i);
    assert.match(
      b2,
      /from public\.tn04eb_smoke_ctx c\s+where c\.id = 1;/
    );
    assert.doesNotMatch(b2, /\b(max|min)\s*\(\s*(lobby_id|session_id|host_id|guest_id|outsider_id)\s*\)/i);
  });

  it("cleanup B : uniquement TN04EB% + legacy TN04EG% ; jamais TN04E% générique ni TN04EA/TN04EX", () => {
    const b = read("supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql");
    const start = b.indexOf("create or replace function public.tn04eb_cleanup_fixtures()");
    assert.ok(start >= 0);
    const end = b.indexOf("$$;", start);
    const body = b.slice(start, end);
    const probe = body
      .replace(/LIKE 'TN04EB%'/gi, "<<OK_EB>>")
      .replace(/like 'TN04EB%'/gi, "<<OK_EB>>")
      .replace(/LIKE 'TN04EG%'/gi, "<<OK_EG>>")
      .replace(/like 'TN04EG%'/gi, "<<OK_EG>>");
    assert.equal(
      /LIKE\s*'TN04E%'/i.test(probe),
      false,
      "cleanup B ne doit pas contenir LIKE 'TN04E%' générique"
    );
    assert.match(body, /like 'TN04EB%'/i);
    assert.match(body, /like 'TN04EG%'/i);
    const like = (s, pat) => s.startsWith(pat.replace(/%$/, ""));
    assert.equal(like("TN04EBabc", "TN04EB%") || like("TN04EBabc", "TN04EG%"), true);
    assert.equal(like("TN04EAabc", "TN04EB%") || like("TN04EAabc", "TN04EG%"), false);
    assert.equal(
      like("TN04EXabc", "TN04EB%") || like("TN04EXabc", "TN04EG%"),
      false,
      "TN04EX ne doit jamais être supprimable par B"
    );
  });

  it("cleanup A : uniquement TN04EA% + legacy TN04EG% ; jamais TN04E% générique ni TN04EX", () => {
    const a = read("supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql");
    const start = a.indexOf("create or replace function public.tn04ea_cleanup_fixtures()");
    assert.ok(start >= 0);
    const end = a.indexOf("$$;", start);
    const body = a.slice(start, end);
    const probe = body
      .replace(/LIKE 'TN04EA%'/gi, "<<OK_EA>>")
      .replace(/LIKE 'TN04EG%'/gi, "<<OK_EG>>");
    assert.equal(
      /LIKE\s*'TN04E%'/i.test(probe),
      false,
      "cleanup A ne doit plus contenir LIKE 'TN04E%' générique"
    );
    assert.match(body, /LIKE 'TN04EA%'/);
    assert.match(body, /LIKE 'TN04EG%'/);
    assert.doesNotMatch(body, /NOT LIKE 'TN04EA%'/);
    assert.doesNotMatch(body, /NOT LIKE 'TN04EB%'/);
    const like = (s, pat) => s.startsWith(pat.replace(/%$/, ""));
    assert.equal(like("TN04EAabc", "TN04EA%") || like("TN04EAabc", "TN04EG%"), true);
    assert.equal(like("TN04EBabc", "TN04EA%") || like("TN04EBabc", "TN04EG%"), false);
    assert.equal(like("TN04EGabc", "TN04EG%"), true);
    assert.equal(
      like("TN04EXabc", "TN04EA%") || like("TN04EXabc", "TN04EG%"),
      false,
      "TN04EX ne doit jamais être supprimable par A"
    );
    assert.match(a, /TN04EXabc/);
  });

  it("migration A idempotence : booléens via jsonb (pas ::boolean)", () => {
    const sql = read("supabase/feature-tiernight-04e-start-live-series.sql");
    assert.doesNotMatch(
      sql,
      /\(v_existing\s*->>\s*'lobbyStarted'\)::boolean/
    );
    assert.doesNotMatch(
      sql,
      /\(v_existing\s*->>\s*'finished'\)::boolean/
    );
    assert.match(sql, /lobbyStarted'\)\s*=\s*'true'::jsonb/);
  });

  it("aucun contenu éditorial TIER_LISTS dans migration launch", () => {
    const s = sql();
    // Noms + items = texte éditorial. Les ids courts (ex. "live") peuvent
    // coïncider avec le vocabulaire domaine (kind='live') — on vérifie les
    // ids distinctifs (≥ 5 chars ou underscore) seulement.
    for (const list of TIER_LISTS) {
      assert.equal(s.includes(list.name), false, `name leaked: ${list.name}`);
      if (list.id.length >= 5 || list.id.includes("_")) {
        assert.equal(
          new RegExp(`["']${list.id}["']`).test(s),
          false,
          `id leaked: ${list.id}`
        );
      }
      for (const item of list.items || []) {
        assert.equal(s.includes(item), false, `item leaked: ${item}`);
      }
    }
    assert.doesNotMatch(s, /McDonald/);
    assert.doesNotMatch(s, /Shrek/);
    assert.doesNotMatch(s, /Situations de vie/);
  });
  it("scripts regen catalogue absents", () => {
    assert.equal(existsSync(join(root, "scripts/_emit-tn04e-catalog.mjs")), false);
    assert.equal(existsSync(join(root, "scripts/_emit-tn04e-sql.mjs")), false);
  });

  it("guest ready : live-prep → tierNightLivePrep ; roster → tierNightPrep", () => {
    const g = guestSql();
    assert.match(g, /tiernight-live-prep/);
    assert.match(g, /tierNightLivePrep/);
    assert.match(g, /tierNightPrep/);
    assert.match(g, /tiernight-prep/);
    assert.doesNotMatch(g, /LIKE '%prep%'/);
    assert.match(g, /pool_invalidate_request uniquement sur tiernight-prep/);
  });
});

describe("FEATURE-TIERNIGHT-04E — validateurs / erreurs UX", () => {
  it("roundCount invalide refuse", () => {
    const built = buildTierNightLiveSeriesLaunchState({ roundCount: 4 });
    assert.equal(built.ok, false);
    assert.equal(built.code, "TNS_LIVE_INVALID_ROUND_COUNT");
  });

  it("custom corrompue refuse", () => {
    const bad = makeCustom(1, { items: ["a"] });
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 3,
      customLists: [bad],
    });
    assert.equal(built.ok, false);
    assert.match(String(built.code), /CORRUPT_CUSTOM|INVALID_CUSTOM/);
  });

  it("map erreurs : jamais code brut", () => {
    const msg = mapTierNightLiveLaunchError("TNS_LIVE_PREP_STALE");
    assert.doesNotMatch(msg, /TNS_LIVE_/);
    assert.ok(msg.length > 10);
  });
});

describe("FEATURE-TIERNIGHT-04E — codecs / legacy / hors scope", () => {
  it("codecs remote transportent series", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /remote\.series = session\.series/);
    assert.match(src, /out\.series = remote\.series/);
  });

  it("force + normal → même markStarted", () => {
    const screen = read("js/screens/tierNightLivePrep.js");
    assert.match(screen, /markStarted:\s*markTierNightLiveSeriesPrepStarted/);
  });

  it("doc : trust boundary sans miroir SQL", () => {
    const doc = read("docs/FEATURE-TIERNIGHT-04E.md");
    assert.match(doc, /TIER_LISTS/);
    assert.doesNotMatch(doc, /catalogue SQL miroir/i);
    assert.doesNotMatch(doc, /drift SQL/i);
    assert.doesNotMatch(doc, /regen catalogue SQL/i);
    assert.match(doc, /SQL terrain validation pending/);
  });
});

describe("FEATURE-TIERNIGHT-04E — politique C/N + anti-bypass", () => {
  function official(n) {
    return {
      id: `off-${n}`,
      name: `Off ${n}`,
      emoji: "📌",
      items: [`O${n}-1`, `O${n}-2`, `O${n}-3`],
      custom: false,
    };
  }

  function buildSeries(lists, runId = "run-cn") {
    return buildTierNightLiveSeriesWire({ lists, runId }).series;
  }

  it("1. C=0 / 0 custom → accepté", () => {
    const series = buildSeries([official(1), official(2), official(3)]);
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: [],
      roundCount: 3,
    });
    assert.equal(r.ok, true);
  });

  it("2. C=0 / proposal custom → rejet POOL_STALE", () => {
    const series = buildSeries([makeCustom(1), official(2), official(3)]);
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: [],
      roundCount: 3,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CUSTOM_POOL_STALE");
  });

  it("3. 0<C<N / toutes customs → accepté", () => {
    const customs = [makeCustom(1), makeCustom(2)];
    const series = buildSeries([customs[0], customs[1], official(1), official(2), official(3)]);
    assert.equal(
      validateTierNightLiveCustomQueuePolicy({ series, customLists: customs, roundCount: 5 }).ok,
      true
    );
  });

  it("4. 0<C<N / custom omise → rejet", () => {
    const customs = [makeCustom(1), makeCustom(2)];
    const series = buildSeries([customs[0], official(1), official(2), official(3), official(4)]);
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: customs,
      roundCount: 5,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CUSTOM_POOL_STALE");
  });

  it("5. 0<C<N / custom étrangère → rejet (count)", () => {
    const customs = [makeCustom(1), makeCustom(2)];
    const foreign = makeCustom(9);
    const series = buildSeries([customs[0], foreign, official(1), official(2), official(3)]);
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: customs,
      roundCount: 5,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CUSTOM_POOL_STALE");
  });

  it("6. C=N / N customs → accepté", () => {
    const customs = [makeCustom(1), makeCustom(2), makeCustom(3)];
    const series = buildSeries(customs);
    assert.equal(
      validateTierNightLiveCustomQueuePolicy({ series, customLists: customs, roundCount: 3 }).ok,
      true
    );
  });

  it("7. C=N / N-1 customs + 1 official → rejet", () => {
    const customs = [makeCustom(1), makeCustom(2), makeCustom(3)];
    const series = buildSeries([customs[0], customs[1], official(1)]);
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: customs,
      roundCount: 3,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CUSTOM_POOL_STALE");
  });

  it("8. C>N / N customs → accepté", () => {
    const customs = [makeCustom(1), makeCustom(2), makeCustom(3), makeCustom(4)];
    const series = buildSeries(customs.slice(0, 3));
    assert.equal(
      validateTierNightLiveCustomQueuePolicy({ series, customLists: customs, roundCount: 3 }).ok,
      true
    );
  });

  it("9. C>N / official dans queue → rejet", () => {
    const customs = [makeCustom(1), makeCustom(2), makeCustom(3), makeCustom(4)];
    const series = buildSeries([customs[0], customs[1], official(1)]);
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: customs,
      roundCount: 3,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CUSTOM_POOL_STALE");
  });

  it("10. custom ajoutée entre prepare et lock → pool stale", () => {
    const atPrepare = [makeCustom(1), makeCustom(2)];
    const series = buildSeries([
      atPrepare[0],
      atPrepare[1],
      official(1),
      official(2),
      official(3),
    ]);
    const atLock = [...atPrepare, makeCustom(3)];
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: atLock,
      roundCount: 5,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CUSTOM_POOL_STALE");
  });

  it("11. custom supprimée entre prepare et lock → pool stale", () => {
    const atPrepare = [makeCustom(1), makeCustom(2)];
    const series = buildSeries([
      atPrepare[0],
      atPrepare[1],
      official(1),
      official(2),
      official(3),
    ]);
    const atLock = [atPrepare[0]];
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: atLock,
      roundCount: 5,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CUSTOM_POOL_STALE");
  });

  it("12. custom-live-* + custom:false → rejet", () => {
    const series = buildSeries([official(1), official(2), official(3)]);
    series.queue[0].listId = `${CUSTOM_LIVE_TIER_LIST_ID_PREFIX}deadbeef-0000-0000-0000-000000000001`;
    series.queue[0].listSnapshot.id = series.queue[0].listId;
    series.queue[0].listSnapshot.custom = false;
    const r = validateTierNightLiveSeriesShape(series);
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CORRUPT_CUSTOM");
  });

  it("13. custom:true + id non custom-live → rejet", () => {
    const series = buildSeries([official(1), official(2), official(3)]);
    series.queue[0].listSnapshot.custom = true;
    series.queue[0].listSnapshot.authorUid = "uid-x";
    series.queue[0].listSnapshot.items = ["a", "b", "c", "d"];
    const r = validateTierNightLiveSeriesShape(series);
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CORRUPT_CUSTOM");
  });

  it("14. duplicate custom ID dans canon → rejet", () => {
    const c = makeCustom(1);
    const series = buildSeries([c, official(1), official(2)]);
    const r = validateTierNightLiveCustomQueuePolicy({
      series,
      customLists: [c, { ...c }],
      roundCount: 3,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TNS_LIVE_CORRUPT_CUSTOM");
  });

  it("15–17. types invalides → codes TNS_LIVE contrôlés", () => {
    assert.equal(parseTierNightLiveJsonInt("abc"), null);
    assert.equal(parseTierNightLiveJsonInt(1.5), null);
    assert.equal(parseTierNightLiveJsonInt(1), 1);
    const series = buildSeries([official(1), official(2), official(3)]);
    const badVer = structuredClone(series);
    badVer.version = "abc";
    assert.equal(validateTierNightLiveSeriesShapeStrict(badVer).ok, false);
    assert.match(String(validateTierNightLiveSeriesShapeStrict(badVer).code), /TNS_LIVE_/);
    const badRc = structuredClone(series);
    badRc.roundCount = "abc";
    assert.equal(validateTierNightLiveSeriesShapeStrict(badRc).ok, false);
    assert.match(String(validateTierNightLiveSeriesShapeStrict(badRc).code), /TNS_LIVE_/);
    const badIdx = structuredClone(series);
    badIdx.roundIndex = "abc";
    assert.equal(validateTierNightLiveSeriesShapeStrict(badIdx).ok, false);
    assert.match(String(validateTierNightLiveSeriesShapeStrict(badIdx).code), /TNS_LIVE_/);
  });

  it("18. setupEpoch invalide — parse défensif", () => {
    assert.equal(parseTierNightLiveJsonInt("nope"), null);
    assert.equal(mapTierNightLiveLaunchError("TNS_LIVE_CUSTOM_POOL_STALE").includes("TNS_LIVE_"), false);
  });
});

describe("FEATURE-TIERNIGHT-04E — soft validate + helpers", () => {
  it("validateTierNightLivePrepForLaunch ok avec pool officiel", () => {
    assert.equal(validateTierNightLivePrepForLaunch().ok, true);
  });

  it("projectTierNightLiveSeriesRound0 refuse series invalide", () => {
    assert.equal(projectTierNightLiveSeriesRound0({ kind: "live" }).ok, false);
  });

  it("buildTierNightLiveSeriesWire length mismatch", () => {
    assert.equal(buildTierNightLiveSeriesWire({ lists: [makeCustom(1)] }).ok, false);
  });
});
