/**
 * FEATURE-TIERNIGHT-03-C1 — consolidation catch-up harness, SERIES migrés, reset prep hub.
 */
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeTierNightPrepRemoteState,
  buildAuthoritativeTierNightPrepReset,
  resolveTierNightRosterDestinationFromSharedState,
  stripLegacySeriesWizardPrepFields,
} from "../js/core/tierNightSeriesPrepContracts.js";
import {
  setTierNightSeriesUiEnabledForTests,
  TIER_NIGHT_SERIES_UI_GATE_KEY,
  isTierNightSeriesUiEnabled,
} from "../js/core/tierNightSeriesGate.js";
import {
  validateTierNightSeriesSetupForLaunch,
  getTierNightSeriesPoolSize,
} from "../js/core/tierNightSeriesSetup.js";
import { prepareTierNightSeriesLaunchAttempt } from "../js/core/tierNightSeriesLaunch.js";
import { TIER_NIGHT_SERIES_ALL_CATEGORIES } from "../js/core/tierNightSeries.js";

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
    },
  },
});

const { getTierNightSeriesPrepEntryScreen, resetTierNightSeriesPrepSession } =
  await import("../js/core/tierNightSeriesPrepSession.js");
const { getState, saveStatePatch } = await import("../js/core/state.js");
const { markTierNightClassicStarted } = await import("../js/core/tierNightLiveSession.js");

const PARTICIPANTS = [
  { userId: "11111111-1111-4111-8111-111111111111", name: "Alice", emoji: "🙂" },
  { userId: "22222222-2222-4222-8222-222222222222", name: "Bob", emoji: "😎" },
];

describe("FEATURE-TIERNIGHT-03-C1 - catch-up harness (preuve vs C)", () => {
  it("arch07 + mpRt utilisent namedExports (exports: ne fournit pas les named ESM)", () => {
    const arch = read("tests/arch07CatchupResidual.test.js");
    const mp = read("tests/mpRtCatchup.test.js");
    assert.match(arch, /namedExports:\s*\{/);
    assert.match(mp, /namedExports:\s*\{/);
    assert.doesNotMatch(arch, /\bexports:\s*\{/);
    assert.doesNotMatch(mp, /\bexports:\s*\{/);
  });

  it("produit exporte toujours applyRemoteSession + HOST_PRESENCE_STALE_MS", () => {
    const sync = read("js/core/gameSync.js");
    const life = read("js/config/lobbyLifecycle.js");
    assert.match(sync, /export function applyRemoteSession/);
    assert.match(life, /export const HOST_PRESENCE_STALE_MS/);
  });

  it("diff C gameSync : priorité phase série, pas de retrait applyRemoteSession", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /tnSeries\.phase/);
    assert.match(sync, /export function applyRemoteSession/);
    // C n’a pas renommé / retiré le helper catch-up
    assert.equal(sync.includes("export function applyRemoteSession"), true);
  });

  it("filRougeVague3 : assertion docs hors catch-up / hors gameSync métier", () => {
    const fil = read("tests/filRougeVague3Cleanup.test.js");
    assert.match(fil, /suppression applicative/i);
    assert.doesNotMatch(fil, /applyRemoteSession|getEffectiveSessionScreen|tierNightPrep/);
  });
});

describe("FEATURE-TIERNIGHT-03-C1 - SERIES assertions migrées (pas affaiblies)", () => {
  it("SERIES-04 : moteur setup/validate/prepare toujours couvert", () => {
    const s04 = read("tests/featureTierNightSeries04.test.js");
    const select = read("js/screens/tierNightSelect.js");
    const prepSession = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(s04, /validateTierNightSeriesSetupForLaunch/);
    assert.match(s04, /prepareTierNightSeriesLaunchAttempt/);
    assert.match(s04, /buildTierNightSeriesLaunchPayload/);
    assert.match(s04, /roundId/);
    assert.match(s04, /EMPTY_ROSTER/);
    assert.match(s04, /enterTierNightSeriesPrep/);
    assert.match(s04, /markTierNightSeriesStarted/);
    // Produit : wizard launch retiré ; prep porte markSeries
    assert.doesNotMatch(select, /launchSeriesFromReview/);
    assert.doesNotMatch(select, /markTierNightSeriesStarted/);
    assert.match(prepSession, /markTierNightSeriesStarted/);
    assert.match(s04, /function rosterPathStepHtml/);
  });

  it("SERIES-04 runtime : queue hors state avant prepare ; validate refuse pool insuffisant", () => {
    assert.equal(getState().tierNightGame?.series?.queue, undefined);
    const bad = validateTierNightSeriesSetupForLaunch({
      path: "series",
      categoryIds: ["survival"],
      roundCount: 8,
    });
    assert.equal(bad.ok, false);
    const prep = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      participants: PARTICIPANTS,
      rng: () => 0,
    });
    assert.equal(prep.ok, true);
    assert.equal(prep.attempt.series.queue.length, 3);
    assert.equal(getState().tierNightGame?.series?.queue, undefined);
  });

  it("SERIES-03b : customs snapshot cohérents (pas d’acceptation permissive)", () => {
    const s03b = read("tests/featureTierNightSeries03b.test.js");
    assert.match(s03b, /CUSTOM_SNAPSHOT_INCONSISTENT/);
    assert.match(s03b, /snapshot\.custom=true/);
    assert.match(s03b, /snapshot\.custom=false/);
    assert.match(s03b, /assert\.equal\(res\.ok, false\)/);
    assert.match(s03b, /assert\.equal\(res\.code, "CUSTOM_SNAPSHOT_INCONSISTENT"\)/);
  });

  it("SERIES-03b / produit : finalize hors select/launch (via playSession D)", () => {
    for (const rel of [
      "js/screens/tierNightSelect.js",
      "js/core/tierNightSeriesLaunch.js",
      "js/core/tierNightLiveSession.js",
    ]) {
      const src = read(rel);
      assert.equal(src.includes("commitTierNightSeriesRoundResult"), false, rel);
      assert.equal(src.includes("finalize_tiernight_series_round"), false, rel);
    }
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /commitTierNightSeriesRoundResult/);
  });
});

describe("FEATURE-TIERNIGHT-03-C1 - reset prep hub", () => {
  it("buildAuthoritative bump epoch ; merge ignore stale epoch bas", () => {
    const reset = buildAuthoritativeTierNightPrepReset({ previousSetupEpoch: 4 });
    assert.equal(reset.setupEpoch, 5);
    assert.deepEqual(reset.ready, {});
    assert.deepEqual(reset.categoryIds, ["*"]);

    const cur = {
      categoryIds: ["survival"],
      roundCount: 3,
      ready: { u1: true },
      setupEpoch: 7,
    };
    const stale = mergeTierNightPrepRemoteState(cur, {
      ...buildAuthoritativeTierNightPrepReset({ previousSetupEpoch: 0 }),
      // epoch 1 < 7
    });
    assert.equal(stale.setupEpoch, 7);
    assert.deepEqual(stale.categoryIds, ["survival"]);
    assert.equal(stale.ready.u1, true);

    const ok = mergeTierNightPrepRemoteState(cur, reset);
    // reset epoch 5 < 7 → toujours stale
    assert.equal(ok.setupEpoch, 7);

    const win = mergeTierNightPrepRemoteState(
      cur,
      buildAuthoritativeTierNightPrepReset({ previousSetupEpoch: 7 })
    );
    assert.equal(win.setupEpoch, 8);
    assert.deepEqual(win.categoryIds, ["*"]);
    assert.deepEqual(win.ready, {});
  });

  it("launchTierNightSelect : hôte + mutation unique + pas consumed", () => {
    const fn =
      read("js/core/restartGame.js").match(
        /export async function launchTierNightSelect\([\s\S]*?^}/m
      )?.[0] || "";
    assert.match(fn, /requireHostToLaunch\("tiernight"\)/);
    assert.match(fn, /buildAuthoritativeTierNightPrepReset/);
    assert.match(fn, /commitPrepSessionLaunch/);
    assert.match(fn, /tierNightPrep:/);
    assert.match(fn, /screen:\s*"tiernight-select"/);
    assert.doesNotMatch(fn, /consumedCustomRosterTopicIds/);
    assert.doesNotMatch(fn, /customRosterTopics/);
  });

  it("resetTierNightSeriesPrepSession bump epoch et préserve consumed", () => {
    saveStatePatch({
      consumedCustomRosterTopicIds: ["roster:custom:x"],
      customRosterTopics: [{ id: "roster:custom:y", name: "Y" }],
      tierNightSeriesPrep: {
        categoryIds: ["survival"],
        roundCount: 3,
        ready: { a: true },
        setupEpoch: 2,
      },
    });
    resetTierNightSeriesPrepSession();
    const prep = getState().tierNightSeriesPrep;
    assert.equal(prep.setupEpoch, 3);
    assert.deepEqual(prep.ready, {});
    assert.deepEqual(prep.categoryIds, ["*"]);
    assert.deepEqual(getState().consumedCustomRosterTopicIds, ["roster:custom:x"]);
    assert.equal(getState().customRosterTopics?.[0]?.id, "roster:custom:y");
  });

  it("source : reset n’est pas dans hydrate/mount/follow générique", () => {
    const prepSession = read("js/core/tierNightSeriesPrepSession.js");
    const sync = read("js/core/gameSync.js");
    // enter avec resetSettings=false ne wipe pas
    assert.match(prepSession, /resetSettings = true/);
    assert.match(prepSession, /resetSettings=false/);
    // hydrate merge ne force pas epoch 0
    assert.match(sync, /mergeTierNightPrepRemoteState/);
    assert.doesNotMatch(
      sync.slice(sync.indexOf("function applyRemoteSession"), sync.indexOf("function applyRemoteSession") + 8000),
      /setupEpoch:\s*0/
    );
  });
});

describe("FEATURE-TIERNIGHT-03-C1 - gate × état partagé", () => {
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("1. Gate OFF + série active → tiernight (gateIgnored)", () => {
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: {
        lobbyStarted: true,
        series: { phase: "ranking", roundIndex: 0, queue: [{}, {}, {}] },
      },
      seriesUiEnabled: false,
    });
    assert.equal(r.screen, "tiernight");
    assert.equal(r.gateIgnored, true);
    assert.equal(r.reason, "series_ranking");
  });

  it("2. Gate ON + legacy actif → tiernight", () => {
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: { lobbyStarted: true, items: ["A", "B"] },
      seriesUiEnabled: true,
    });
    assert.equal(r.screen, "tiernight");
    assert.equal(r.reason, "legacy_active");
    assert.equal(r.gateIgnored, true);
  });

  it("3. Gate ON + prep (pas de partie) → prep", () => {
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: { lobbyStarted: false },
      hasTierNightPrep: true,
      seriesUiEnabled: true,
    });
    assert.equal(r.screen, "tiernight-prep");
    assert.equal(r.gateIgnored, false);
  });

  it("4. Kill switch OFF + rien d’actif → select sûr (jamais classic)", () => {
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: { lobbyStarted: false },
      seriesUiEnabled: false,
      declaredScreen: "tiernight-select",
    });
    assert.equal(r.screen, "tiernight-select");
    assert.equal(r.reason, "series_entry_blocked");
  });

  it("5. Gate ON + declared select (wizard fantôme) → prep", () => {
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: { lobbyStarted: false },
      seriesUiEnabled: true,
      declaredScreen: "tiernight-select",
    });
    assert.equal(r.screen, "tiernight-prep");
  });

  it("6–7. Changement gate local pendant série/legacy → même destination", () => {
    const series = {
      lobbyStarted: true,
      series: { phase: "ranking", roundIndex: 1, queue: [{}, {}, {}] },
    };
    const a = resolveTierNightRosterDestinationFromSharedState({
      tierNight: series,
      seriesUiEnabled: true,
    });
    const b = resolveTierNightRosterDestinationFromSharedState({
      tierNight: series,
      seriesUiEnabled: false,
    });
    assert.equal(a.screen, b.screen);
    assert.equal(a.gateIgnored, true);

    const legacy = { lobbyStarted: true, items: ["A"] };
    const c = resolveTierNightRosterDestinationFromSharedState({
      tierNight: legacy,
      seriesUiEnabled: true,
    });
    const d = resolveTierNightRosterDestinationFromSharedState({
      tierNight: legacy,
      seriesUiEnabled: false,
    });
    assert.equal(c.screen, d.screen);
    assert.equal(c.reason, "legacy_active");
  });

  it("8. Phase série prioritaire vs declared écran (miroir gameSync)", () => {
    const sync = read("js/core/gameSync.js");
    const idxSeries = sync.indexOf("tnSeries.phase");
    const idxLobby = sync.indexOf('st.tierNight?.lobbyStarted) return "tiernight"');
    assert.ok(idxSeries > 0 && idxLobby > idxSeries);
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: {
        lobbyStarted: false,
        series: { phase: "ranking", queue: [{}] },
      },
      seriesUiEnabled: false,
      declaredScreen: "tiernight-select",
    });
    assert.equal(r.screen, "tiernight");
  });
});

describe("FEATURE-TIERNIGHT-03-C1 - legacy comportemental", () => {
  beforeEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    saveStatePatch({
      tierNightGame: { runId: null, lobbyStarted: false, items: [], series: null },
      consumedCustomRosterTopicIds: ["keep-me"],
    });
  });

  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("hydrate mono sans series → entry tiernight ; pas de queue", () => {
    saveStatePatch({
      tierNightGame: {
        runId: "leg-1",
        lobbyStarted: true,
        items: ["Alice", "Bob"],
        topicId: "roster:who",
      },
    });
    assert.equal(getTierNightSeriesPrepEntryScreen(), "tiernight");
    assert.equal(getState().tierNightGame.series, undefined);
    assert.equal(getState().consumedCustomRosterTopicIds[0], "keep-me");
  });

  it("replay gate ON : classic API refusée ; entry sans série → prep", async () => {
    setTierNightSeriesUiEnabledForTests(true);
    assert.equal(isTierNightSeriesUiEnabled(), true);
    saveStatePatch({
      tierNightGame: { runId: "done", lobbyStarted: false, items: [], series: null },
    });
    assert.equal(getTierNightSeriesPrepEntryScreen(), "tiernight-prep");
    const res = await markTierNightClassicStarted({
      topicId: "roster:who",
      mode: "roster",
      modifier: "normal",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "SERIES_GATE_BLOCKS_CLASSIC");
  });

  it("wizard strip : path n’entre pas dans SoT", () => {
    const cleaned = stripLegacySeriesWizardPrepFields({
      path: "series",
      categoryIds: ["*"],
      roundCount: 5,
      setupEpoch: 1,
    });
    assert.equal(cleaned.path, undefined);
    assert.equal(getTierNightSeriesPoolSize(["survival"]) >= 3, true);
  });
});
