/**
 * BUG-TIERNIGHT-PREP-GUEST-01 — invité ready + custom sur tiernight-prep.
 */
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPlayerContribution } from "../js/core/playerContribution.js";
import {
  mergeTierNightPrepRemoteState,
  shouldHonorPoolInvalidateRequest,
  customRosterTopicsPoolSignature,
} from "../js/core/tierNightSeriesPrepContracts.js";
import { isTierNightSeriesUiEnabled } from "../js/core/tierNightSeriesGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

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
    },
  },
});

const { getState, saveStatePatch } = await import("../js/core/state.js");
const prepSession = await import("../js/core/tierNightSeriesPrepSession.js");
const { createPrepLobbyController } = await import("../js/core/usePrepLobby.js");

describe("BUG-TIERNIGHT-PREP-GUEST-01 - détection contribution", () => {
  it("3–5. ready invité UID + expectedSetupEpoch (detect → contribute)", () => {
    const hit = detectPlayerContribution(
      {
        tierNightPrep: {
          ready: { [UID]: true },
          expectedSetupEpoch: 4,
        },
      },
      UID
    );
    assert.deepEqual(hit, {
      game: "tiernight",
      kind: "ready",
      value: { ready: true, expectedSetupEpoch: 4 },
    });
    const unready = detectPlayerContribution(
      {
        tierNightPrep: {
          ready: { [UID]: false },
          expectedSetupEpoch: 4,
        },
      },
      UID
    );
    assert.equal(unready.value.ready, false);
    assert.equal(
      detectPlayerContribution(
        {
          tierNightPrep: {
            ready: { [OTHER]: true },
            expectedSetupEpoch: 4,
          },
        },
        UID
      ),
      null
    );
    // booléen nu sans epoch → refusé
    assert.equal(
      detectPlayerContribution(
        { tierNightPrep: { ready: { [UID]: true } } },
        UID
      ),
      null
    );
    // alias setupEpoch accepté
    assert.deepEqual(
      detectPlayerContribution(
        { tierNightPrep: { ready: { [UID]: true }, setupEpoch: 3 } },
        UID
      ).value,
      { ready: true, expectedSetupEpoch: 3 }
    );
  });

  it("stale epoch : contribution avec mauvais expectedSetupEpoch reste routable (SQL refuse)", () => {
    const hit = detectPlayerContribution(
      {
        tierNightPrep: {
          ready: { [UID]: true },
          expectedSetupEpoch: 4,
        },
      },
      UID
    );
    assert.equal(hit.value.expectedSetupEpoch, 4);
  });

  it("14–16. poolInvalidateRequest + customEntryId ; pas de bump epoch invité", () => {
    const hit = detectPlayerContribution(
      {
        tierNightPrep: {
          poolInvalidateRequest: {
            requestId: `inv-${UID}-1`,
            customEntryId: "roster:custom-1",
          },
        },
      },
      UID
    );
    assert.deepEqual(hit, {
      game: "tiernight",
      kind: "pool_invalidate_request",
      value: {
        requestId: `inv-${UID}-1`,
        customEntryId: "roster:custom-1",
      },
    });
    // string seule refusée (anti-spam)
    assert.equal(
      detectPlayerContribution(
        { tierNightPrep: { poolInvalidateRequestId: "inv-x" } },
        UID
      ),
      null
    );
    // blob autoritatif hôte (epoch+ready clear) ≠ contribution invité
    assert.equal(
      detectPlayerContribution(
        {
          tierNightPrep: {
            setupEpoch: 5,
            ready: {},
            poolInvalidateRequestId: null,
          },
        },
        UID
      ),
      null
    );
  });

  it("25. aucune forme HOST_ONLY sur chemins autorisés", () => {
    assert.ok(
      detectPlayerContribution(
        {
          tierNightPrep: {
            ready: { [UID]: true },
            expectedSetupEpoch: 1,
          },
        },
        UID
      )
    );
    assert.ok(
      detectPlayerContribution(
        {
          tierNightPrep: {
            poolInvalidateRequest: {
              requestId: "inv-x",
              customEntryId: "roster:c1",
            },
          },
        },
        UID
      )
    );
  });
});

describe("BUG-TIERNIGHT-PREP-GUEST-01 - wiring source", () => {
  it("ready utilise commitPrepReadyToggle + expectedSetupEpoch", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(src, /commitPrepReadyToggle/);
    assert.match(src, /stateKey:\s*"tierNightPrep"/);
    assert.match(src, /expectedSetupEpoch/);
    assert.match(src, /buildRemoteReadyPatch/);
    assert.match(src, /Ready obsolète/);
  });

  it("5. ready invité n'appelle jamais syncTierNightSeriesPrepSession full blob", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    const fn = src.slice(
      src.indexOf("export async function setTierNightSeriesPrepReady"),
      src.indexOf("export function allTierNightSeriesPrepReady")
    );
    assert.doesNotMatch(fn, /syncTierNightSeriesPrepSession/);
    assert.doesNotMatch(fn, /tierNightPrepToRemote\(session\)/);
  });

  it("SQL refuse ready stale (expectedSetupEpoch)", () => {
    const sql = read("supabase/feature-tiernight-03-prep-guest-contribute.sql");
    assert.match(sql, /expectedSetupEpoch/);
    assert.match(sql, /Ready obsolète/);
    assert.match(sql, /tierNightPrep,setupEpoch/);
  });

  it("10–11. custom via RPC atomique ; pas d’invalidate prêts (READY-CUSTOM-01)", () => {
    const custom = read("js/core/customRosterTopicSession.js");
    assert.match(custom, /rpcUpsertPlayerCustomEntry/);
    assert.doesNotMatch(custom, /patchGameState\s*\(/);
    const prep = read("js/core/tierNightSeriesPrepSession.js");
    const add = prep.slice(
      prep.indexOf("export async function addCustomRosterTopicFromPrep"),
      prep.indexOf("export async function removeCustomRosterTopicFromPrep")
    );
    assert.match(add, /addCustomRosterTopicAndSync/);
    assert.doesNotMatch(add, /invalidateTierNightSeriesPrepReadiness/);
    const remove = prep.slice(
      prep.indexOf("export async function removeCustomRosterTopicFromPrep"),
      prep.indexOf("export function getTierNightSeriesPrepEntryScreen")
    );
    assert.match(remove, /deleteCustomRosterTopicAndSync/);
    assert.doesNotMatch(remove, /invalidateTierNightSeriesPrepReadiness/);
    assert.doesNotMatch(remove, /ready:\s*\{\}/);
  });

  it("15–16. invité invalidate = request catalogue only (sans clear ready local)", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    const start = src.indexOf("export async function invalidateTierNightSeriesPrepReadiness");
    const end = src.indexOf(
      "/**\n * Mutation autoritative : setupEpoch++",
      start
    );
    const fn = src.slice(start, end > start ? end : src.indexOf("async function publishAuthoritativePrepReadyInvalidation", start));
    assert.match(fn, /poolInvalidateRequest/);
    assert.match(fn, /customEntryId/);
    assert.match(fn, /ne pas toucher ready local/);
    assert.match(fn, /patchGameStateWithFeedback/);
    const guest = fn.slice(fn.indexOf("CUSTOM_ENTRY_REQUIRED"));
    assert.doesNotMatch(guest, /ready:\s*\{\s*\}/);
  });

  it("honor hôte : schedule sans void silencieux", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /scheduleTierNightPrepHostHonors/);
    assert.doesNotMatch(
      sync.slice(
        sync.indexOf("scheduleTierNightPrepHostHonors") - 80,
        sync.indexOf("scheduleTierNightPrepHostHonors") + 200
      ),
      /\bvoid\s+import/
    );
    const prep = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(prep, /honorChain/);
    assert.match(prep, /staleCallback/);
    assert.match(prep, /reconciled/);
    assert.match(prep, /ackPoolInvalidateRequestOnly/);
  });

  it("écran prep : contrôleur + handlers ready/custom", () => {
    const screen = read("js/screens/tierNightPrep.js");
    assert.match(screen, /createPrepLobbyController/);
    assert.match(screen, /setTierNightSeriesPrepReady/);
    assert.match(screen, /addCustomRosterTopicFromPrep/);
    assert.match(screen, /btn-ready/);
    assert.match(screen, /add-roster-topic/);
  });

  it("26. SQL isolation + ACL + epoch", () => {
    const sql = read("supabase/feature-tiernight-03-prep-guest-contribute.sql");
    assert.match(sql, /pool_invalidate_request/);
    assert.match(sql, /customEntryId/);
    assert.match(sql, /v_screen is distinct from 'tiernight-prep'/);
    assert.match(sql, /v_row\.game_id is distinct from 'tiernight'/);
    assert.match(sql, /revoke all[\s\S]*from anon/i);
    assert.match(sql, /expectedSetupEpoch/);
    assert.match(sql, /menu.*TierNight prep|pas de menu/i);
    const inv = read("js/core/tierNightSeriesPrepSession.js");
    const fn = inv.slice(
      inv.indexOf("export async function invalidateTierNightSeriesPrepReadiness"),
      inv.indexOf("async function publishAuthoritativePrepReadyInvalidation")
    );
    assert.doesNotMatch(fn, /\bvoid\s+patchGameState/);
    assert.match(fn, /await patchGameStateWithFeedback/);
  });

  it("gate ON ; pas de classic", () => {
    assert.equal(isTierNightSeriesUiEnabled(), true);
    assert.doesNotMatch(
      read("js/screens/tierNightPrep.js"),
      /markTierNightClassicStarted/
    );
  });
});

describe("BUG-TIERNIGHT-PREP-GUEST-01 - merge / authority", () => {
  it("6. ready stale epoch ignoré", () => {
    const cur = {
      setupEpoch: 5,
      ready: { [UID]: true },
      categoryIds: ["*"],
      roundCount: 3,
    };
    const next = mergeTierNightPrepRemoteState(cur, {
      setupEpoch: 2,
      ready: { [UID]: false },
    });
    assert.equal(next.setupEpoch, 5);
    assert.equal(next.ready[UID], true);
  });

  it("1–2 / 7. merge ready même epoch par UID (pas replace map)", () => {
    const next = mergeTierNightPrepRemoteState(
      { setupEpoch: 3, ready: { [UID]: true, [OTHER]: true } },
      { ready: { [UID]: false } }
    );
    assert.equal(next.ready[UID], false);
    assert.equal(next.ready[OTHER], true);
  });

  it("17–18. honor request id une fois", () => {
    assert.equal(shouldHonorPoolInvalidateRequest(null, "inv-1"), true);
    assert.equal(shouldHonorPoolInvalidateRequest("inv-1", "inv-1"), false);
    assert.equal(shouldHonorPoolInvalidateRequest("inv-1", "inv-2"), true);
  });

  it("19. empreinte customs", () => {
    const a = customRosterTopicsPoolSignature([{ id: "b" }, { id: "a" }]);
    const b = customRosterTopicsPoolSignature([{ id: "a" }, { id: "b" }]);
    assert.equal(a, b);
    assert.notEqual(
      a,
      customRosterTopicsPoolSignature([{ id: "a" }, { id: "c" }])
    );
  });
});

describe("BUG-TIERNIGHT-PREP-GUEST-01 - contrôleur + session locale", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    prepSession.resetTierNightSeriesPrepInvalidateGuardsForTests();
    saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: {},
        setupEpoch: 2,
        poolInvalidateRequestId: null,
      },
      consumedCustomRosterTopicIds: ["keep-consumed"],
      customTierLists: [{ id: "live-keep", name: "L", items: ["x"] }],
      customRosterTopics: [],
      user: { ...getState().user, name: "Bob" },
    });
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("1–2 / 8. contrôleur toggle ready local + bouton réutilisable", async () => {
    const ctrl = createPrepLobbyController({
      localKey: "Bob",
      getReadyMap: () => prepSession.getTierNightSeriesPrepSession().ready || {},
    });
    let renders = 0;
    await ctrl.toggleReady({
      setReady: async (name, ready) => {
        await prepSession.setTierNightSeriesPrepReady(name, ready);
      },
      simulateReady: null,
      render: () => {
        renders += 1;
      },
    });
    assert.equal(prepSession.getTierNightSeriesPrepSession().ready.Bob, true);
    assert.ok(renders >= 2);
    assert.equal(ctrl.localReadyState(), true);

    await ctrl.toggleReady({
      setReady: async (name, ready) => {
        await prepSession.setTierNightSeriesPrepReady(name, ready);
      },
      simulateReady: null,
      render: () => {
        renders += 1;
      },
    });
    assert.equal(prepSession.getTierNightSeriesPrepSession().ready.Bob, false);
    assert.equal(ctrl.localReadyState(), false);

    // échec réseau simulé : rollback entrée locale uniquement
    const before = { ...prepSession.getTierNightSeriesPrepSession().ready };
    saveStatePatch({
      tierNightSeriesPrep: {
        ...prepSession.getTierNightSeriesPrepSession(),
        ready: { ...before, Alice: true },
      },
    });
    let failed = false;
    const ctrl2 = createPrepLobbyController({
      localKey: "Bob",
      getReadyMap: () => prepSession.getTierNightSeriesPrepSession().ready || {},
    });
    try {
      await ctrl2.toggleReady({
        setReady: async () => {
          failed = true;
          throw new Error("boom");
        },
        render: () => {},
      });
    } catch {
      /* attendu */
    }
    assert.equal(failed, true);
    assert.equal(prepSession.getTierNightSeriesPrepSession().ready.Alice, true);
    assert.equal(ctrl2.localReadyState(), false);
  });

  it("9 / 22–24. custom local sans bump epoch ; consumed / queue / Rank Live intacts", async () => {
    const beforeEpoch = prepSession.getTierNightSeriesPrepSession().setupEpoch;
    const res = await prepSession.addCustomRosterTopicFromPrep("Thème invité QA");
    assert.equal(res.ok, true);
    assert.ok(getState().customRosterTopics.some((t) => t.name === "Thème invité QA"));
    assert.deepEqual(getState().consumedCustomRosterTopicIds, ["keep-consumed"]);
    assert.equal(getState().customTierLists[0].id, "live-keep");
    assert.equal(getState().tierNightGame?.series ?? null, null);
    assert.equal(getState().tierNightGame?.runId ?? null, null);
    assert.equal(prepSession.getTierNightSeriesPrepSession().setupEpoch, beforeEpoch);
  });

  it("13. custom rejeté → pas d'invalidate (source + comportement)", async () => {
    const beforeEpoch = prepSession.getTierNightSeriesPrepSession().setupEpoch;
    const res = await prepSession.addCustomRosterTopicFromPrep("");
    assert.equal(res.ok, false);
    assert.equal(prepSession.getTierNightSeriesPrepSession().setupEpoch, beforeEpoch);
  });

  it("21. ownership delete autre UID refusé (source session)", () => {
    const custom = read("js/core/customRosterTopicSession.js");
    assert.match(custom, /isCustomRosterTopicOwnedBy/);
    assert.match(custom, /Tu ne peux supprimer que tes propres thèmes/);
  });

  it("honor : request catalogue → ack sans bump (READY-CUSTOM-01)", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(src, /catalog_ack_only/);
    assert.match(src, /ackPoolInvalidateRequestOnly/);
    assert.match(src, /catalog_signature_only/);
    assert.match(src, /lastHonoredPoolInvalidateRequestId = String\(requestId\)/);
  });

  it("honor schedule : catch terminal + génération stale", () => {
    assert.equal(typeof prepSession.scheduleTierNightPrepHostHonors, "function");
    const p = prepSession.scheduleTierNightPrepHostHonors(
      { poolInvalidateRequestId: null },
      []
    );
    assert.equal(typeof p.then, "function");
  });

  it("deux empreintes customs coalescent conceptuellement (coalesce ms)", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(src, /AUTHORITATIVE_INVALIDATE_COALESCE_MS\s*=\s*750/);
  });
});
