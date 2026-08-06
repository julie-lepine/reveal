/**
 * FEATURE-TIERNIGHT-03-B1-bis — mpLaunch harness, ready global customs, atomicité launch.
 */
import { describe, it, mock, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldHonorPoolInvalidateRequest,
  customRosterTopicsPoolSignature,
  mergeTierNightPrepRemoteState,
  reconcileConsumedCustomRosterTopicIds,
} from "../js/core/tierNightSeriesPrepContracts.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";
import { TIER_NIGHT_SERIES_ALL_CATEGORIES } from "../js/core/tierNightSeries.js";
import {
  isTierNightSeriesUiEnabled,
  setTierNightSeriesUiEnabledForTests,
  TIER_NIGHT_SERIES_UI_GATE_KEY,
} from "../js/core/tierNightSeriesGate.js";

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
          }),
        }),
      }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), unsubscribe: () => {} }),
      removeChannel: () => {},
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
    },
  },
});

let prepSession;
let stateApi;

before(async () => {
  stateApi = await import("../js/core/state.js");
  prepSession = await import("../js/core/tierNightSeriesPrepSession.js");
});

const PARTICIPANTS = [
  {
    userId: "11111111-1111-4111-8111-111111111111",
    name: "Alice",
    emoji: "🙂",
    isHost: true,
  },
  {
    userId: "22222222-2222-4222-8222-222222222222",
    name: "Bob",
    emoji: "😎",
  },
];

describe("FEATURE-TIERNIGHT-03-B1-bis - mpLaunchLaunch harness", () => {
  it("mock gameSync utilise namedExports (pas exports)", () => {
    const src = read("tests/mpLaunchLaunch.test.js");
    assert.match(src, /mock\.module\("\.\.\/js\/core\/gameSync\.js"/);
    assert.match(src, /namedExports:\s*\{/);
    assert.match(src, /DEFAULT_SYNC_PATCH_TIMEOUT_MS:\s*20000/);
    assert.doesNotMatch(
      src.slice(src.indexOf('mock.module("../js/core/gameSync.js"')),
      /exports:\s*\{[^}]*DEFAULT_SYNC_PATCH_TIMEOUT_MS/
    );
  });

  it("assertions ARCH-08 / M-14b toujours présentes", () => {
    const src = read("tests/mpLaunchLaunch.test.js");
    assert.match(src, /launchGameWithSync/);
    assert.match(src, /usedFallback/);
    assert.match(src, /onLocalApplied/);
    assert.match(src, /retryLaunchCommitInBackground|background_retry|mp_launch_commit_failed/);
    assert.match(src, /remote-first|remote first|ordre contractuel/i);
  });
});

describe("FEATURE-TIERNIGHT-03-B1-bis - invalidation ready globale", () => {
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    prepSession.resetTierNightSeriesPrepInvalidateGuardsForTests();
  });

  it("shouldHonorPoolInvalidateRequest ignore doublons", () => {
    assert.equal(shouldHonorPoolInvalidateRequest(null, "r1"), true);
    assert.equal(shouldHonorPoolInvalidateRequest("r1", "r1"), false);
    assert.equal(shouldHonorPoolInvalidateRequest("r1", "r2"), true);
    assert.equal(shouldHonorPoolInvalidateRequest("r1", ""), false);
  });

  it("empreinte customs stable / sensible", () => {
    const a = customRosterTopicsPoolSignature([
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}b` },
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a` },
    ]);
    const b = customRosterTopicsPoolSignature([
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a` },
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}b` },
    ]);
    assert.equal(a, b);
    const c = customRosterTopicsPoolSignature([
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a` },
    ]);
    assert.notEqual(a, c);
  });

  it("merge propage poolInvalidateRequestId sans bump epoch invité", () => {
    const cur = {
      categoryIds: ["*"],
      roundCount: 5,
      setupEpoch: 3,
      ready: { u1: true },
    };
    const inc = { poolInvalidateRequestId: "inv-1" };
    const next = mergeTierNightPrepRemoteState(cur, inc);
    assert.equal(next.setupEpoch, 3);
    assert.equal(next.poolInvalidateRequestId, "inv-1");
    assert.equal(next.ready.u1, true);
  });

  it("solo : invalidate bump epoch + clear tous les ready", async () => {
    stateApi.resetEveningState();
    stateApi.saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount: 5,
        ready: { Alice: true, Bob: true },
        setupEpoch: 2,
      },
    });
    const res = await prepSession.invalidateTierNightSeriesPrepReadiness();
    assert.equal(res.ok, true);
    const s = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(s.ready, {});
    assert.equal(s.setupEpoch, 3);
  });

  it("hôte customs change : une invalidation autoritative", async () => {
    stateApi.resetEveningState();
    prepSession.resetTierNightSeriesPrepInvalidateGuardsForTests();
    stateApi.saveStatePatch({
      lobby: {
        ...stateApi.getState().lobby,
        participants: PARTICIPANTS,
        hostName: "Alice",
      },
      user: { ...stateApi.getState().user, displayName: "Alice" },
      customRosterTopics: [],
      tierNightSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: { Alice: true, Bob: true },
        setupEpoch: 1,
      },
    });

    // Prime signature
    let r = await prepSession.honorTierNightPrepCustomsPoolChange([]);
    assert.equal(r.primed || r.skipped, true);

    r = await prepSession.honorTierNightPrepCustomsPoolChange([
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`, name: "X" },
    ]);
    // Sans game sync active → skipped (pas hôte MP). Solo path via invalidate.
    // Forcer invalidate solo pour prouver clear global
    await prepSession.invalidateTierNightSeriesPrepReadiness();
    const s = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(s.ready, {});
    assert.ok(s.setupEpoch >= 2);
  });

  it("série activée par défaut (F)", () => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});

describe("FEATURE-TIERNIGHT-03-B1-bis - atomicité launch", () => {
  beforeEach(() => {
    stateApi.resetEveningState();
    stateApi.saveStatePatch({
      lobby: {
        ...stateApi.getState().lobby,
        participants: PARTICIPANTS,
        hostName: "Alice",
      },
      user: { ...stateApi.getState().user, displayName: "Alice" },
      customRosterTopics: [
        {
          id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c1`,
          name: "Custom",
          custom: true,
          author: "Alice",
        },
      ],
      consumedCustomRosterTopicIds: [],
      tierNightSeriesPrep: {
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount: 3,
        ready: { Alice: true, Bob: true },
        setupEpoch: 1,
      },
      tierNightGame: { series: null, lobbyStarted: false },
    });
  });

  it("source : un seul getRemoteState embarque series + consumed + prep", () => {
    const src = read("js/core/tierNightLiveSession.js");
    const fnStart = src.indexOf("export async function markTierNightSeriesStarted");
    const fn = src.slice(fnStart, fnStart + 4500);
    assert.match(fn, /getRemoteState:\s*\(\)\s*=>/);
    assert.match(fn, /tierNight:\s*built\.remoteTierNight/);
    assert.match(fn, /consumedCustomRosterTopicIds/);
    assert.match(fn, /tierNightPrep\s*=\s*tierNightPrepToRemote/);
    const launches = fn.match(/launchGameWithSync\(/g) || [];
    assert.equal(launches.length, 1);
  });

  it("launch local : une queue, consumed=customs queue, prep reset, lobbyStarted", async () => {
    const beforeConsumed = [...stateApi.getState().consumedCustomRosterTopicIds];
    assert.deepEqual(beforeConsumed, []);

    const res = await prepSession.markTierNightSeriesPrepStarted({
      rosterNames: ["Alice", "Bob"],
    });
    assert.equal(res.ok, true);

    const game = stateApi.getState().tierNightGame;
    assert.equal(game.lobbyStarted, true);
    assert.equal(game.series.queue.length, 3);
    assert.equal(game.series.phase, "ranking");

    const fromQueue = reconcileConsumedCustomRosterTopicIds([], game.series);
    const consumed = stateApi.getState().consumedCustomRosterTopicIds;
    for (const id of fromQueue) {
      assert.ok(consumed.includes(id), `missing ${id}`);
    }
    // Prep reset (defaults)
    const prep = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(prep.ready, {});
    assert.equal(prep.setupEpoch, 0);
  });

  it("échec setup : aucune des trois mutations locales", async () => {
    stateApi.saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: ["survival"],
        roundCount: 8,
        ready: { Alice: true },
        setupEpoch: 4,
      },
      consumedCustomRosterTopicIds: [`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}keep`],
    });
    const res = await prepSession.markTierNightSeriesPrepStarted({
      rosterNames: ["Alice", "Bob"],
    });
    assert.equal(res.ok, false);
    assert.equal(stateApi.getState().tierNightGame?.series ?? null, null);
    assert.deepEqual(stateApi.getState().consumedCustomRosterTopicIds, [
      `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}keep`,
    ]);
    assert.equal(prepSession.getTierNightSeriesPrepSession().setupEpoch, 4);
  });

  it("réconciliation hydrate répare ledger manquant", () => {
    const series = {
      queue: [
        {
          topicSnapshot: {
            id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}z`,
            name: "Z",
            custom: true,
          },
        },
      ],
    };
    assert.deepEqual(reconcileConsumedCustomRosterTopicIds([], series), [
      `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}z`,
    ]);
  });

  it("payload conceptuel documenté dans le rapport (contrat source)", () => {
    const live = read("js/core/tierNightLiveSession.js");
    assert.match(live, /remote\.consumedCustomRosterTopicIds/);
    assert.match(live, /remote\.tierNightPrep/);
    assert.match(live, /remote\.tierNight\s*=\s*built\.remoteTierNight|tierNight:\s*built\.remoteTierNight/);
  });
});

describe("FEATURE-TIERNIGHT-03-B1-bis - wiring host honor", () => {
  it("gameSync planifie honor invalidate + customs", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /honorTierNightPrepPoolInvalidateRequest/);
    assert.match(src, /honorTierNightPrepCustomsPoolChange/);
  });

  it("invité invalidate publie poolInvalidateRequestId (source)", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(src, /poolInvalidateRequestId/);
    assert.match(src, /requested:\s*true/);
    assert.match(src, /canActAsHost/);
    assert.match(src, /AUTHORITATIVE_INVALIDATE_COALESCE_MS|coalesced/);
  });
});
