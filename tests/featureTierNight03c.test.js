/**
 * FEATURE-TIERNIGHT-03-C — unification parcours roster autour de tiernight-prep.
 */
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTierNightSeriesUiEnabled,
  setTierNightSeriesUiEnabledForTests,
  TIER_NIGHT_SERIES_UI_GATE_KEY,
} from "../js/core/tierNightSeriesGate.js";
import {
  mergeTierNightPrepRemoteState,
  stripLegacySeriesWizardPrepFields,
} from "../js/core/tierNightSeriesPrepContracts.js";

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

const { getTierNightSeriesPrepEntryScreen, resetTierNightSeriesPrepSession, enterTierNightSeriesPrep } =
  await import("../js/core/tierNightSeriesPrepSession.js");
const { returnToTierNightSelectStep } = await import("../js/core/tierNightNav.js");
const {
  initRouter,
  navigate,
  getCurrentScreen,
  getNavStack,
  getScreenParams,
  resetNav,
  registerScreen,
} = await import("../js/core/router.js");
const { getState, saveStatePatch } = await import("../js/core/state.js");

function fakeApp() {
  return {
    innerHTML: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

describe("FEATURE-TIERNIGHT-03-C - gate ON source", () => {
  it("select : roster → prep ; aucun wizard / grille / classic gaté", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /FEATURE-TIERNIGHT-03-F/);
    assert.match(select, /openSeriesPrepFromRoster/);
    assert.match(select, /enterTierNightSeriesPrep/);
    assert.doesNotMatch(select, /data-roster-path/);
    assert.doesNotMatch(select, /function rosterPathStepHtml/);
    assert.doesNotMatch(select, /function seriesCategoryStepHtml/);
    assert.doesNotMatch(select, /function seriesCountStepHtml/);
    assert.doesNotMatch(select, /function seriesReviewStepHtml/);
    assert.doesNotMatch(select, /launchSeriesFromReview/);
    assert.doesNotMatch(select, /markTierNightSeriesStarted/);
    assert.doesNotMatch(select, /topicStepHtml/);
    assert.doesNotMatch(select, /markTierNightClassicStarted/);
  });

  it("nav : topic/roster-path → prep (parcours final)", () => {
    const nav = read("js/core/tierNightNav.js");
    assert.match(nav, /enterTierNightSeriesPrep/);
    assert.match(nav, /resetSettings:\s*false/);
    assert.match(nav, /navigate\(\s*["']tiernight-prep["']/);
    assert.match(nav, /LEGACY_ROSTER_STEPS/);
  });

  it("classic API bloquée (parcours série final)", () => {
    const live = read("js/core/tierNightLiveSession.js");
    assert.match(live, /SERIES_GATE_BLOCKS_CLASSIC/);
    assert.match(live, /FEATURE-TIERNIGHT-03-F/);
  });

  it("phase série prioritaire dans resolveActivePlayScreen", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /tnSeries\.phase/);
    assert.match(sync, /phase === "between_rounds"/);
    assert.match(sync, /phase === "series_end"/);
    assert.match(sync, /phase === "ranking"/);
  });

  it("gate documentée produit final + kill switch", () => {
    const gate = read("js/core/tierNightSeriesGate.js");
    assert.match(gate, /Kill switch/);
    assert.match(gate, /Défaut ON/);
    assert.match(gate, /jamais.*classic/i);
  });
});

describe("FEATURE-TIERNIGHT-03-C - plus de rollback classic (F)", () => {
  it("grille + classic absents du select produit", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.doesNotMatch(select, /topicStepHtml/);
    assert.doesNotMatch(select, /markTierNightClassicStarted/);
    assert.doesNotMatch(select, /Gate OFF rollback/);
    assert.match(select, /startLiveGame/);
  });

  it("série activée par défaut (clé absente)", () => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});

describe("FEATURE-TIERNIGHT-03-C - sync wizard legacy", () => {
  it("stripLegacy retire path / seriesSetup", () => {
    const cleaned = stripLegacySeriesWizardPrepFields({
      categoryIds: ["survival"],
      roundCount: 3,
      ready: {},
      setupEpoch: 2,
      path: "series",
      seriesSetup: { path: "series" },
      wizardRoundCount: 7,
    });
    assert.deepEqual(cleaned.categoryIds, ["survival"]);
    assert.equal(cleaned.roundCount, 3);
    assert.equal(cleaned.setupEpoch, 2);
    assert.equal(cleaned.path, undefined);
    assert.equal(cleaned.seriesSetup, undefined);
    assert.equal(cleaned.wizardRoundCount, undefined);
  });

  it("merge ignore champs wizard et préserve prep canonique", () => {
    const cur = {
      categoryIds: ["*"],
      roundCount: 5,
      ready: { a: true },
      setupEpoch: 4,
    };
    const next = mergeTierNightPrepRemoteState(cur, {
      path: "series",
      seriesSetup: { categoryIds: ["x"], roundCount: 8 },
      wizardCategoryIds: ["bad"],
      ready: { b: true },
      setupEpoch: 4,
    });
    assert.deepEqual(next.categoryIds, ["*"]);
    assert.equal(next.roundCount, 5);
    assert.equal(next.setupEpoch, 4);
    assert.equal(next.path, undefined);
    assert.equal(next.seriesSetup, undefined);
    assert.equal(next.ready.a, true);
    assert.equal(next.ready.b, true);
  });

  it("merge epoch plus grand avec wizard noise → settings sans path", () => {
    const next = mergeTierNightPrepRemoteState(
      { categoryIds: ["*"], roundCount: 5, ready: { a: true }, setupEpoch: 1 },
      {
        path: "single",
        categoryIds: ["survival"],
        roundCount: 3,
        ready: {},
        setupEpoch: 2,
      }
    );
    assert.deepEqual(next.categoryIds, ["survival"]);
    assert.equal(next.roundCount, 3);
    assert.equal(next.setupEpoch, 2);
    assert.equal(next.path, undefined);
    assert.deepEqual(next.ready, {});
  });
});

describe("FEATURE-TIERNIGHT-03-C - legacy hydrate / entry", () => {
  beforeEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    saveStatePatch({
      tierNightGame: {
        runId: null,
        lobbyStarted: false,
        items: [],
        series: null,
      },
    });
  });

  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("session legacy sans series → entry tiernight (pas de queue synthétique)", () => {
    saveStatePatch({
      tierNightGame: {
        runId: "legacy-run",
        lobbyStarted: true,
        items: ["Alice", "Bob"],
        topicId: "roster:who",
      },
    });
    assert.equal(getTierNightSeriesPrepEntryScreen(), "tiernight");
    assert.equal(getState().tierNightGame?.series, undefined);
  });

  it("série ranking → entry tiernight", () => {
    saveStatePatch({
      tierNightGame: {
        runId: "s1",
        lobbyStarted: true,
        series: { phase: "ranking", roundIndex: 0, roundCount: 3, queue: [{}, {}, {}] },
      },
    });
    assert.equal(getTierNightSeriesPrepEntryScreen(), "tiernight");
  });

  it("aucune partie active → prep", () => {
    saveStatePatch({
      tierNightGame: { runId: "x", lobbyStarted: false, series: null },
    });
    assert.equal(getTierNightSeriesPrepEntryScreen(), "tiernight-prep");
  });
});

describe("FEATURE-TIERNIGHT-03-C - navigation gate ON", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn();
      return 1;
    };
    resetNav();
    initRouter(fakeApp());
    for (const id of [
      "home",
      "lobby",
      "game-select",
      "tiernight-select",
      "tiernight-prep",
      "tiernight-create-roster",
      "tiernight-create",
    ]) {
      registerScreen(id, () => null);
    }
    setTierNightSeriesUiEnabledForTests(true);
    resetTierNightSeriesPrepSession();
  });

  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("returnTo topic sous gate → prep (pas grille / pas create fantôme)", () => {
    navigate("home", { reset: true });
    navigate("game-select");
    navigate("tiernight-select");
    navigate("tiernight-create-roster");

    returnToTierNightSelectStep({ step: "topic", mode: "roster" });

    assert.equal(getCurrentScreen(), "tiernight-prep");
    assert.equal(getNavStack().includes("tiernight-create-roster"), false);
    assert.ok(getNavStack().includes("tiernight-select"));
    assert.equal(getNavStack().at(-1), "tiernight-prep");
  });

  it("Rank Live returnTo list inchangé sous gate", () => {
    navigate("home", { reset: true });
    navigate("tiernight-create");
    returnToTierNightSelectStep({ step: "list", mode: "live" });
    assert.equal(getCurrentScreen(), "tiernight-select");
    assert.deepEqual(getScreenParams(), { step: "list", mode: "live" });
  });

  it("enterTierNightSeriesPrep pile canonique", async () => {
    const res = await enterTierNightSeriesPrep({ resetSettings: true });
    assert.equal(res.ok, true);
    assert.equal(getCurrentScreen(), "tiernight-prep");
    assert.deepEqual(getNavStack(), [
      "home",
      "lobby",
      "game-select",
      "tiernight-select",
      "tiernight-prep",
    ]);
  });
});

describe("FEATURE-TIERNIGHT-03-C - restart / prep reset (source)", () => {
  it("launchTierNightSelect reset prep + préserve consumed hors patch", () => {
    const src = read("js/core/restartGame.js");
    const fn = src.match(/export async function launchTierNightSelect\([\s\S]*?^}/m)?.[0] || "";
    assert.match(fn, /tierNightSeriesPrep/);
    assert.match(fn, /buildAuthoritativeTierNightPrepReset/);
    assert.match(fn, /tierNightPrep/);
    assert.doesNotMatch(fn, /consumedCustomRosterTopicIds/);
    assert.match(fn, /tiernight-select/);
    assert.match(fn, /requireHostToLaunch/);
  });

  it("create-roster reste legacy (retour topic) — nav gate redirige", () => {
    const create = read("js/screens/tierNightCreateRoster.js");
    assert.match(create, /step:\s*"topic"/);
    const nav = read("js/core/tierNightNav.js");
    assert.match(nav, /enterTierNightSeriesPrep/);
  });
});

describe("FEATURE-TIERNIGHT-03-C - getEffectiveSessionScreen priorité série", () => {
  it("source : series phase avant lobbyStarted seul", () => {
    const sync = read("js/core/gameSync.js");
    const idxSeries = sync.indexOf("tnSeries.phase");
    const idxLobby = sync.indexOf('st.tierNight?.lobbyStarted) return "tiernight"');
    assert.ok(idxSeries > 0);
    assert.ok(idxLobby > idxSeries);
  });
});

describe("FEATURE-TIERNIGHT-03-C - classic blocked runtime", () => {
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("markTierNightClassicStarted refuse sous gate", async () => {
    setTierNightSeriesUiEnabledForTests(true);
    const { markTierNightClassicStarted } = await import("../js/core/tierNightLiveSession.js");
    const res = await markTierNightClassicStarted({
      topicId: "roster:who-drinks",
      mode: "roster",
      modifier: "normal",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "SERIES_GATE_BLOCKS_CLASSIC");
  });
});
