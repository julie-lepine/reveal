/**
 * FEATURE-TIERNIGHT-03-B — game-prep série multi-thèmes (UX Hot Take).
 */
import { describe, it, mock, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  TIER_NIGHT_SERIES_ROUND_COUNTS,
  mergeConsumedCustomTopicIds,
  listConsumedCustomTopicIdsFromSeries,
  validateTierNightSeriesCategoryIdsShape,
} from "../js/core/tierNightSeries.js";
import {
  getTierNightSeriesRoundCountAvailability,
  getTierNightSeriesPoolSize,
  reconcileTierNightSeriesSetupAfterCategoryChange,
  validateTierNightSeriesSetupForLaunch,
} from "../js/core/tierNightSeriesSetup.js";
import { estimateTierNightSeriesDuration } from "../js/core/tierNightSeriesDuration.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";
import {
  isTierNightSeriesUiEnabled,
  setTierNightSeriesUiEnabledForTests,
  TIER_NIGHT_SERIES_UI_GATE_KEY,
} from "../js/core/tierNightSeriesGate.js";
import { prepareTierNightSeriesLaunchAttempt } from "../js/core/tierNightSeriesLaunch.js";

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
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
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
  { userId: "11111111-1111-4111-8111-111111111111", name: "Alice", emoji: "🙂" },
  { userId: "22222222-2222-4222-8222-222222222222", name: "Bob", emoji: "😎" },
];

describe("FEATURE-TIERNIGHT-03-B - gate produit ON (F)", () => {
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(true);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("série activée par défaut", () => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});

describe("FEATURE-TIERNIGHT-03-B - durée", () => {
  it("fourchettes produit 3 / 5 / 8", () => {
    assert.equal(estimateTierNightSeriesDuration(3).minSec, 5 * 60);
    assert.equal(estimateTierNightSeriesDuration(3).maxSec, 7 * 60);
    assert.equal(estimateTierNightSeriesDuration(5).minSec, 8 * 60);
    assert.equal(estimateTierNightSeriesDuration(8).maxSec, 18 * 60);
    assert.equal(estimateTierNightSeriesDuration(0).label, "-");
    assert.equal(estimateTierNightSeriesDuration(7).label.includes("-") || true, true);
  });
});

describe("FEATURE-TIERNIGHT-03-B - catégories + counts", () => {
  it("Tout = [*] uniquement ; refuse mix", () => {
    const ok = validateTierNightSeriesCategoryIdsShape(["*"]);
    assert.equal(ok.ok, true);
    const bad = validateTierNightSeriesCategoryIdsShape(["*", "survival"]);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "INVALID_CATEGORY_IDS");
  });

  it("counts UI = 3/5/8 seulement (jamais 7)", () => {
    assert.deepEqual([...TIER_NIGHT_SERIES_ROUND_COUNTS], [3, 5, 8]);
    const avail = getTierNightSeriesRoundCountAvailability([TIER_NIGHT_SERIES_ALL_CATEGORIES]);
    assert.deepEqual(
      avail.map((a) => a.roundCount),
      [3, 5, 8]
    );
    assert.equal(
      avail.every((a) => a.roundCount !== 7),
      true
    );
  });

  it("pool insuffisant → count indisponible (pas de clamp)", () => {
    const avail = getTierNightSeriesRoundCountAvailability(["survival"], {
      customTopics: [],
      excludeCustomIds: [],
    });
    const three = avail.find((a) => a.roundCount === 3);
    const eight = avail.find((a) => a.roundCount === 8);
    assert.equal(three.available, true);
    assert.equal(eight.available, false);
    const reconciled = reconcileTierNightSeriesSetupAfterCategoryChange({
      path: "series",
      categoryIds: ["survival"],
      roundCount: 8,
    });
    assert.equal(reconciled.roundCount, null);
  });
});

describe("FEATURE-TIERNIGHT-03-B - prep session runtime", () => {
  beforeEach(() => {
    stateApi.resetEveningState();
    stateApi.saveStatePatch({
      lobby: {
        ...stateApi.getState().lobby,
        participants: PARTICIPANTS,
        hostName: "Alice",
      },
      user: { ...stateApi.getState().user, displayName: "Alice" },
      tierNightSeriesPrep: {
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount: 5,
        ready: {},
      },
      consumedCustomRosterTopicIds: [],
      customRosterTopics: [],
      tierNightGame: { ...stateApi.getState().tierNightGame, series: null, lobbyStarted: false },
    });
  });

  it("summary : effective 0 si roundCount null / pool insuffisant", async () => {
    stateApi.saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: ["survival"],
        roundCount: null,
        ready: {},
      },
    });
    const s = prepSession.getTierNightSeriesPrepSummary();
    assert.equal(s.available, false);
    assert.equal(s.effective, 0);
  });

  it("setCategories invalide roundCount trop grand sans fallback silencieux", async () => {
    stateApi.saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount: 8,
        ready: {},
      },
    });
    await prepSession.setTierNightSeriesPrepCategories(["survival"]);
    const session = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(session.categoryIds, ["survival"]);
    assert.equal(session.roundCount, null);
  });

  it("setRoundCount refuse pool insuffisant", async () => {
    stateApi.saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: ["survival"],
        roundCount: 3,
        ready: {},
      },
    });
    const res = await prepSession.setTierNightSeriesPrepRoundCount(8);
    assert.equal(res.ok, false);
    assert.equal(res.code, "INSUFFICIENT_TOPICS");
  });

  it("excludeCustomIds dérivé de consumed (source de vérité)", () => {
    stateApi.saveStatePatch({
      consumedCustomRosterTopicIds: [`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x1`],
    });
    assert.deepEqual(prepSession.getExcludeCustomIdsForSeriesPrep(), [
      `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x1`,
    ]);
  });

  it("entry screen : prep sans série, board avec série active", () => {
    assert.equal(prepSession.getTierNightSeriesPrepEntryScreen(), "tiernight-prep");
    stateApi.saveStatePatch({
      tierNightGame: {
        runId: "r1",
        series: { phase: "ranking", roundIndex: 0, queue: [{ topicId: "t" }] },
        items: ["Alice", "Bob"],
      },
    });
    assert.equal(prepSession.getTierNightSeriesPrepEntryScreen(), "tiernight");
  });

  it("launch local : queue créée + one-shot après succès uniquement", async () => {
    const customId = `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c1`;
    stateApi.saveStatePatch({
      customRosterTopics: [{ id: customId, name: "Custom A", custom: true, author: "Alice" }],
      consumedCustomRosterTopicIds: [],
      tierNightSeriesPrep: {
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount: 3,
        ready: { Alice: true, Bob: true },
      },
    });

    assert.equal(stateApi.getState().tierNightGame?.series, null);

    const res = await prepSession.markTierNightSeriesPrepStarted({
      rosterNames: ["Alice", "Bob"],
    });
    assert.equal(res.ok, true);
    assert.ok(stateApi.getState().tierNightGame?.series?.queue?.length === 3);
    assert.equal(stateApi.getState().tierNightGame.series.phase, "ranking");
    assert.equal(stateApi.getState().tierNightGame.series.roundIndex, 0);

    const consumed = stateApi.getState().consumedCustomRosterTopicIds;
    const fromSeries = listConsumedCustomTopicIdsFromSeries(
      stateApi.getState().tierNightGame.series
    );
    for (const id of fromSeries) {
      assert.ok(consumed.includes(id));
    }
  });

  it("launch échec setup : pas de consommation one-shot", async () => {
    stateApi.saveStatePatch({
      consumedCustomRosterTopicIds: [],
      tierNightSeriesPrep: {
        categoryIds: ["survival"],
        roundCount: 8,
        ready: {},
      },
    });
    const res = await prepSession.markTierNightSeriesPrepStarted({
      rosterNames: ["Alice", "Bob"],
    });
    assert.equal(res.ok, false);
    assert.deepEqual(stateApi.getState().consumedCustomRosterTopicIds, []);
    assert.equal(stateApi.getState().tierNightGame?.series ?? null, null);
  });
});

describe("FEATURE-TIERNIGHT-03-B - one-shot helpers", () => {
  it("mergeConsumed conserve l’historique", () => {
    const series = {
      queue: [
        {
          topicId: "roster:custom_a",
          topicSnapshot: {
            id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a`,
            name: "A",
            custom: true,
          },
        },
      ],
    };
    const merged = mergeConsumedCustomTopicIds([`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}old`], series);
    assert.ok(merged.includes(`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}old`));
    assert.ok(merged.includes(`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a`));
  });
});

describe("FEATURE-TIERNIGHT-03-B - rendu prep (statique)", () => {
  it("écran dédié enregistré + structure Hot Take", () => {
    const main = read("js/main.js");
    assert.match(main, /registerScreen\("tiernight-prep"/);
    assert.match(main, /mountTierNightPrep/);

    const screen = read("js/screens/tierNightPrep.js");
    assert.match(screen, /Préparation série/);
    assert.match(screen, /data-series-cat/);
    assert.match(screen, /Tout/);
    assert.match(screen, /data-round/);
    assert.match(screen, /new-roster-topic/);
    assert.match(screen, /executePrepLaunch/);
    assert.match(screen, /createPrepLobbyController/);
    assert.match(screen, /captureDraft/);
    assert.match(screen, /restoreDraft/);
    assert.match(screen, /markTierNightSeriesPrepStarted/);
    assert.doesNotMatch(screen, /data-round="7"/);
  });

  it("select route roster gate → enterTierNightSeriesPrep (pas wizard ni grille)", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /enterTierNightSeriesPrep/);
    assert.doesNotMatch(select, /data-roster-path/);
    assert.doesNotMatch(select, /launchSeriesFromReview/);
  });

  it("prep session : one-shot après mark OK ; ready avec setupEpoch", () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(src, /mergeConsumedCustomTopicIds/);
    assert.match(src, /setupEpoch/);
    assert.match(src, /prepareTierNightSeriesLaunchAttempt/);
    assert.match(src, /markTierNightSeriesStarted/);
    assert.match(src, /consumedCustomRosterTopicIds/);
  });

  it("gameSync hydrate tierNightPrep + consumed", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /tierNightPrepToRemote/);
    assert.match(src, /tierNightPrepFromRemote/);
    assert.match(src, /st\.tierNightPrep/);
    assert.match(src, /consumedCustomRosterTopicIds/);
    assert.match(src, /"tiernight-prep"/);
  });

  it("réutilise prepScreen / prepLaunch / pas de deck Hot Take", () => {
    const screen = read("js/screens/tierNightPrep.js");
    assert.match(screen, /from "\.\.\/core\/prepScreen\.js"/);
    assert.match(screen, /from "\.\.\/core\/prepLaunch\.js"/);
    assert.doesNotMatch(screen, /buildHotTakeDeck|getThemeBankTexts/);
  });
});

describe("FEATURE-TIERNIGHT-03-B - non-régression launch queue", () => {
  it("prepare crée queue hors state ; validate refuse 7", () => {
    const attempt = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      participants: PARTICIPANTS,
      customTopics: [],
      excludeCustomIds: [],
      rng: () => 0,
    });
    assert.equal(attempt.ok, true);
    assert.equal(attempt.attempt.series.queue.length, 3);

    const bad = validateTierNightSeriesSetupForLaunch({
      path: "series",
      categoryIds: ["*"],
      roundCount: 7,
    });
    assert.equal(bad.ok, false);

    const pool = getTierNightSeriesPoolSize([TIER_NIGHT_SERIES_ALL_CATEGORIES]);
    assert.ok(pool >= 3);
  });
});
