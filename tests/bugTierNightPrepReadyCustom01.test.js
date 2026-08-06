/**
 * BUG-TIERNIGHT-PREP-READY-CUSTOM-01 — customs n’invalident plus les prêts.
 */
import { describe, it, mock, beforeEach, afterEach } from "node:test";
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
          }),
        }),
      }),
    },
  },
});

const stateApi = await import("../js/core/state.js");
const prepSession = await import("../js/core/tierNightSeriesPrepSession.js");
const { CUSTOM_ROSTER_TOPIC_ID_PREFIX } = await import(
  "../js/core/customRosterTopics.js"
);
const { TIER_NIGHT_SERIES_ALL_CATEGORIES } = await import(
  "../js/core/tierNightSeries.js"
);
const { didTierNightSeriesPrepSetupChange } = await import(
  "../js/core/tierNightSeriesPrepContracts.js"
);

const PARTICIPANTS = [
  { name: "Alice", userId: "11111111-1111-4111-8111-111111111111" },
  { name: "Bob", userId: "22222222-2222-4222-8222-222222222222" },
];

function seedPrep({ ready = {}, setupEpoch = 4, roundCount = 5 } = {}) {
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
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount,
      ready: { ...ready },
      setupEpoch,
      poolInvalidateRequestId: null,
    },
  });
}

describe("bugTierNightPrepReadyCustom01 - customs ≠ ready clear", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(stateApi.getState());
    seedPrep({ ready: { Alice: true, Bob: true }, setupEpoch: 4 });
  });

  afterEach(() => {
    stateApi.saveStatePatch(snapshot);
  });

  it("add-01 J1 prêt + add custom → prêts + setupEpoch inchangés", async () => {
    const before = prepSession.getTierNightSeriesPrepSession();
    const res = await prepSession.addCustomRosterTopicFromPrep("Thème J2");
    assert.equal(res.ok, true);
    const after = prepSession.getTierNightSeriesPrepSession();
    assert.equal(after.setupEpoch, before.setupEpoch);
    assert.equal(after.ready.Alice, true);
    assert.equal(after.ready.Bob, true);
    assert.ok(
      stateApi.getState().customRosterTopics.some((t) => t.name === "Thème J2")
    );
  });

  it("add-02 host add while both ready → prêts conservés", async () => {
    const epoch = prepSession.getTierNightSeriesPrepSession().setupEpoch;
    await prepSession.addCustomRosterTopicFromPrep("Host custom");
    const s = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(s.ready, { Alice: true, Bob: true });
    assert.equal(s.setupEpoch, epoch);
  });

  it("add-05 add failed → prêts inchangés", async () => {
    const before = structuredClone(prepSession.getTierNightSeriesPrepSession());
    const res = await prepSession.addCustomRosterTopicFromPrep("");
    assert.equal(res.ok, false);
    const after = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(after.ready, before.ready);
    assert.equal(after.setupEpoch, before.setupEpoch);
  });

  it("add-06/18 add then structural epoch still 4 ; ready valide même epoch", async () => {
    await prepSession.addCustomRosterTopicFromPrep("Keep epoch");
    assert.equal(prepSession.getTierNightSeriesPrepSession().setupEpoch, 4);
    assert.equal(prepSession.getTierNightSeriesPrepSession().ready.Alice, true);
  });

  it("add-07/08 honor request + fingerprint → pas de clear ready", async () => {
    const r1 = await prepSession.honorTierNightPrepCustomsPoolChange([
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a`, name: "A" },
    ]);
    // no MP → skipped, but source contract forbids bump
    const src = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(src, /catalog_signature_only/);
    assert.match(src, /catalog_ack_only/);
    assert.doesNotMatch(
      src.slice(
        src.indexOf("export async function honorTierNightPrepCustomsPoolChange"),
        src.indexOf("export function scheduleTierNightPrepHostHonors")
      ),
      /publishAuthoritativePrepReadyInvalidation/
    );
    assert.equal(prepSession.getTierNightSeriesPrepSession().ready.Alice, true);
    void r1;
  });

  it("del-09 remove custom → prêts + epoch inchangés", async () => {
    const added = await prepSession.addCustomRosterTopicFromPrep("To delete");
    assert.equal(added.ok, true);
    const id = added.id;
    const epoch = prepSession.getTierNightSeriesPrepSession().setupEpoch;
    const res = await prepSession.removeCustomRosterTopicFromPrep(id);
    assert.equal(res.ok, true);
    const s = prepSession.getTierNightSeriesPrepSession();
    assert.equal(s.setupEpoch, epoch);
    assert.equal(s.ready.Alice, true);
    assert.equal(s.ready.Bob, true);
  });

  it("del-11 remove failed → prêts inchangés", async () => {
    const before = structuredClone(prepSession.getTierNightSeriesPrepSession());
    const res = await prepSession.removeCustomRosterTopicFromPrep("missing-id");
    assert.equal(res?.ok, false);
    assert.deepEqual(
      prepSession.getTierNightSeriesPrepSession().ready,
      before.ready
    );
  });

  it("del-13 remove absent idempotent sans reset", async () => {
    const epoch = prepSession.getTierNightSeriesPrepSession().setupEpoch;
    await prepSession.removeCustomRosterTopicFromPrep(
      `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}ghost`
    );
    assert.equal(prepSession.getTierNightSeriesPrepSession().setupEpoch, epoch);
    assert.equal(prepSession.getTierNightSeriesPrepSession().ready.Alice, true);
  });

  it("struct-15/16 catégories / roundCount invalident prêts + bump epoch", async () => {
    const cat = await prepSession.setTierNightSeriesPrepCategories(["survie"]);
    assert.equal(cat.ok, true);
    let s = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(s.ready, {});
    assert.ok(s.setupEpoch > 4);

    seedPrep({ ready: { Alice: true }, setupEpoch: 4, roundCount: 3 });
    // Ensure count 5 available with all cats
    seedPrep({ ready: { Alice: true, Bob: true }, setupEpoch: 4, roundCount: 3 });
    const rc = await prepSession.setTierNightSeriesPrepRoundCount(5);
    assert.equal(rc.ok, true);
    s = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(s.ready, {});
    assert.ok(s.setupEpoch > 4);
  });

  it("struct-17 didSetupChange false for identical settings", () => {
    const prev = {
      categoryIds: ["*"],
      roundCount: 5,
      setupEpoch: 4,
      ready: { Alice: true },
    };
    assert.equal(
      didTierNightSeriesPrepSetupChange(prev, {
        categoryIds: ["*"],
        roundCount: 5,
      }),
      false
    );
    assert.equal(
      didTierNightSeriesPrepSetupChange(prev, {
        categoryIds: ["*"],
        roundCount: 8,
      }),
      true
    );
  });

  it("struct-18/19 add/remove source ne bump pas setupEpoch", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    const add = src.slice(
      src.indexOf("export async function addCustomRosterTopicFromPrep"),
      src.indexOf("export async function removeCustomRosterTopicFromPrep")
    );
    const remove = src.slice(
      src.indexOf("export async function removeCustomRosterTopicFromPrep"),
      src.indexOf("export function getTierNightSeriesPrepEntryScreen")
    );
    assert.doesNotMatch(add, /invalidateTierNightSeriesPrepReadiness/);
    assert.doesNotMatch(remove, /invalidateTierNightSeriesPrepReadiness/);
    assert.doesNotMatch(remove, /ready:\s*\{\}/);
  });

  it("launch-20 queue built from live catalog at launch (source)", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    const launch = src.slice(
      src.indexOf("export async function launchTierNightSeriesFromPrep"),
      src.indexOf("launchTierNightSeriesFromPrep") + 2500
    );
    // find prepare call area
    assert.match(src, /prepareTierNightSeriesLaunchAttempt/);
    assert.match(src, /customTopics:\s*getCustomRosterTopics\(\)/);
  });

  it("reload-25 prêts locaux survivent à un patch customs sans epoch", () => {
    const epoch = 4;
    stateApi.saveStatePatch({
      customRosterTopics: [
        {
          id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}z`,
          name: "Z",
          author: "Bob",
        },
      ],
      tierNightSeriesPrep: {
        ...prepSession.getTierNightSeriesPrepSession(),
        setupEpoch: epoch,
        ready: { Alice: true, Bob: true },
      },
    });
    assert.equal(prepSession.getTierNightSeriesPrepSession().setupEpoch, epoch);
    assert.equal(prepSession.getTierNightSeriesPrepSession().ready.Alice, true);
  });

  it("guest invalidate path no longer clears local ready (source)", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    const start = src.indexOf("export async function invalidateTierNightSeriesPrepReadiness");
    const end = src.indexOf(
      "/**\n * Mutation autoritative : setupEpoch++",
      start
    );
    const fn = src.slice(start, end > start ? end : start + 1);
    assert.match(fn, /ne pas toucher ready local/);
    const guest = fn.slice(fn.indexOf("CUSTOM_ENTRY_REQUIRED"));
    assert.doesNotMatch(guest, /ready:\s*\{\s*\}/);
  });
});
