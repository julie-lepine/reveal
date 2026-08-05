/**
 * FEATURE-TIERNIGHT-SERIES-04 — setup UI gaté + launch série.
 */
import { describe, it, afterEach } from "node:test";
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
  createEmptyTierNightSeriesSetup,
  listTierNightSeriesCategoryOptions,
  getTierNightSeriesRoundCountAvailability,
  validateTierNightSeriesSetupForLaunch,
  reconcileTierNightSeriesSetupAfterCategoryChange,
  getTierNightSeriesPoolSize,
} from "../js/core/tierNightSeriesSetup.js";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  buildTierNightSeriesRoundId,
} from "../js/core/tierNightSeries.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";
import {
  prepareTierNightSeriesLaunchAttempt,
  buildTierNightSeriesLaunchPayload,
} from "../js/core/tierNightSeriesLaunch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

const PARTICIPANTS = [
  { userId: "11111111-1111-4111-8111-111111111111", name: "Alice", emoji: "🙂" },
  { userId: "22222222-2222-4222-8222-222222222222", name: "Bob", emoji: "😎" },
];

describe("FEATURE-TIERNIGHT-SERIES-04 - gate interne", () => {
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("désactivé par défaut", () => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    assert.equal(isTierNightSeriesUiEnabled(), false);
  });

  it("activable pour tests", () => {
    setTierNightSeriesUiEnabledForTests(true);
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });

  it("select n’expose la série que derrière le gate", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /isTierNightSeriesUiEnabled/);
    assert.match(select, /data-roster-path="series"/);
    assert.match(select, /seriesUi \? "roster-path" : "topic"/);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-04 - setup temporaire", () => {
  it("crée un setup vide sans runId/queue", () => {
    const s = createEmptyTierNightSeriesSetup();
    assert.deepEqual(s, { path: null, categoryIds: null, roundCount: null });
  });

  it("catégories : counts sans customs ni disabled", () => {
    const opts = listTierNightSeriesCategoryOptions();
    assert.ok(opts.length >= 3);
    const all = getTierNightSeriesPoolSize([TIER_NIGHT_SERIES_ALL_CATEGORIES]);
    assert.equal(all, 10);
    assert.equal(getTierNightSeriesPoolSize(["survival"]), 3);
  });

  it("3 disponible / 5 et 7 indisponibles sur survie", () => {
    const avail = getTierNightSeriesRoundCountAvailability(["survival"]);
    assert.deepEqual(
      avail.map((a) => [a.roundCount, a.available]),
      [
        [3, true],
        [5, false],
        [7, false],
      ]
    );
  });

  it("invalide roundCount après changement de catégorie", () => {
    const next = reconcileTierNightSeriesSetupAfterCategoryChange({
      path: "series",
      categoryIds: ["survival"],
      roundCount: 5,
    });
    assert.equal(next.roundCount, null);
  });

  it("validate bloquer pool insuffisant", () => {
    const bad = validateTierNightSeriesSetupForLaunch({
      path: "series",
      categoryIds: ["survival"],
      roundCount: 7,
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "INSUFFICIENT_TOPICS");
  });

  it("validate OK toutes catégories × 7", () => {
    const ok = validateTierNightSeriesSetupForLaunch({
      path: "series",
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 7,
    });
    assert.equal(ok.ok, true);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-04 - prepare + payload launch", () => {
  it("prepare : runId final utilisé pour tous les roundId", () => {
    const prep = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0.5,
      participants: PARTICIPANTS,
    });
    assert.equal(prep.ok, true);
    const { attempt } = prep;
    assert.ok(attempt.runId);
    assert.equal(attempt.series.phase, "ranking");
    assert.equal(attempt.series.roundIndex, 0);
    assert.deepEqual(attempt.series.scoredRoundIds, []);
    assert.deepEqual(attempt.series.completedRoundIds, []);
    assert.equal(attempt.queue.length, 3);
    const topicIds = new Set();
    attempt.queue.forEach((e, i) => {
      assert.equal(e.roundId, buildTierNightSeriesRoundId(attempt.runId, i));
      assert.ok(e.topicSnapshot?.id);
      assert.ok(!String(e.topicId).includes(CUSTOM_ROSTER_TOPIC_ID_PREFIX));
      topicIds.add(e.topicId);
    });
    assert.equal(topicIds.size, 3);
    assert.equal(attempt.topicId, attempt.queue[0].topicId);
    assert.equal(attempt.playerRoster.length, 2);
    assert.deepEqual(attempt.items, ["Alice", "Bob"]);
  });

  it("payload remote contient series validée ; placements/finished vides", () => {
    const prep = prepareTierNightSeriesLaunchAttempt({
      categoryIds: ["social"],
      roundCount: 3,
      rng: () => 0.2,
      participants: PARTICIPANTS,
    });
    const built = buildTierNightSeriesLaunchPayload(prep.attempt);
    assert.equal(built.ok, true);
    assert.ok(built.remoteTierNight.series);
    assert.equal(built.remoteTierNight.series.phase, "ranking");
    assert.equal(built.remoteTierNight.lobbyStarted, true);
    assert.deepEqual(built.remoteTierNight.placements, {});
    assert.deepEqual(built.remoteTierNight.finished, {});
    assert.equal(built.localGame.series.roundIndex, 0);
    assert.equal(built.remoteTierNight.topicId, prep.attempt.queue[0].topicId);
  });

  it("même attempt → mêmes roundId (retry sans nouveau RNG)", () => {
    const prep = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0.9,
      participants: PARTICIPANTS,
    });
    const a = prep.attempt;
    const b1 = buildTierNightSeriesLaunchPayload(a);
    const b2 = buildTierNightSeriesLaunchPayload(a);
    assert.equal(b1.remoteTierNight.series.queue[0].roundId, a.queue[0].roundId);
    assert.equal(
      b1.remoteTierNight.series.queue[0].roundId,
      b2.remoteTierNight.series.queue[0].roundId
    );
  });

  it("roster vide → erreur", () => {
    const prep = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      participants: [],
    });
    assert.equal(prep.ok, false);
    assert.equal(prep.code, "EMPTY_ROSTER");
  });
});

describe("FEATURE-TIERNIGHT-SERIES-04 - non-branchement finalize + mono", () => {
  it("aucune RPC finalize dans select / game / advance / launch", () => {
    for (const rel of [
      "js/screens/tierNightSelect.js",
      "js/games/tierNight.js",
      "js/core/gameSync.js",
      "js/screens/tierNightEnd.js",
      "js/core/tierNightSeriesLaunch.js",
      "js/core/tierNightLiveSession.js",
    ]) {
      const src = read(rel);
      assert.equal(src.includes("commitTierNightSeriesRoundResult"), false, rel);
      assert.equal(src.includes("finalize_tiernight_series_round"), false, rel);
    }
  });

  it("mono startGame reste séparé de launchSeries", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /markTierNightClassicStarted/);
    assert.match(select, /markTierNightSeriesStarted/);
    assert.match(select, /async function startGame/);
    assert.match(select, /async function launchSeriesFromReview/);
  });

  it("create-roster retourne toujours topic/roster", () => {
    const create = read("js/screens/tierNightCreateRoster.js");
    assert.match(create, /step:\s*"topic"/);
    assert.match(create, /mode:\s*"roster"/);
  });

  it("markTierNightSeriesStarted existe et utilise build payload", () => {
    const live = read("js/core/tierNightLiveSession.js");
    assert.match(live, /export async function markTierNightSeriesStarted/);
    assert.match(live, /buildTierNightSeriesLaunchPayload/);
  });
});
