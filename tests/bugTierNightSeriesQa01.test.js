/**
 * BUG-TIERNIGHT-SERIES-QA-01 — queue priorité custom + categoryIds connus.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  buildTierNightSeriesQueue,
  filterUnconsumedCustomTopics,
  listConsumedCustomTopicIdsFromSeries,
  validateTierNightSeriesCategoryIds,
} from "../js/core/tierNightSeries.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";
import { validateTierNightSeriesSetupForLaunch } from "../js/core/tierNightSeriesSetup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function rngFrom(vals) {
  let i = 0;
  return () => vals[i++ % vals.length];
}

const OFFICIAL = [
  { id: "o1", name: "Off 1", emoji: "1", categoryId: "survival", enabled: true },
  { id: "o2", name: "Off 2", emoji: "2", categoryId: "survival", enabled: true },
  { id: "o3", name: "Off 3", emoji: "3", categoryId: "survival", enabled: true },
  { id: "o4", name: "Off 4", emoji: "4", categoryId: "social", enabled: true },
  { id: "o5", name: "Off 5", emoji: "5", categoryId: "chaos", enabled: true },
  { id: "o6", name: "Off 6", emoji: "6", categoryId: "social", enabled: true },
  { id: "o7", name: "Off 7", emoji: "7", categoryId: "chaos", enabled: true },
  { id: "o8", name: "Off 8", emoji: "8", categoryId: "survival", enabled: true },
];

function customs(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c${i + 1}`,
    name: `Custom ${i + 1}`,
    custom: true,
  }));
}

function topicIds(built) {
  return built.queue.map((e) => e.topicSnapshot.id);
}

function countCustoms(built) {
  return built.queue.filter((e) => e.topicSnapshot.custom === true).length;
}

function countOfficials(built) {
  return built.queue.filter((e) => e.topicSnapshot.custom !== true).length;
}

function isCustomId(id) {
  return String(id || "").startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX);
}

describe("BUG-TIERNIGHT-SERIES-QA-01 - queue priorité custom", () => {
  it("1. N=3 C=0 → 3 officiels", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: [],
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(built.queue.length, 3);
    assert.equal(countCustoms(built), 0);
    assert.equal(countOfficials(built), 3);
  });

  it("2. N=3 C=1 → custom garanti + 2 officiels", () => {
    const cu = customs(1);
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: cu,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: rngFrom([0.2, 0.8, 0.1, 0.9, 0.3]),
    });
    assert.equal(built.ok, true);
    assert.equal(countCustoms(built), 1);
    assert.equal(countOfficials(built), 2);
    assert.ok(topicIds(built).includes(cu[0].id));
    assert.deepEqual(built.consumedCustomTopicIds, [cu[0].id]);
  });

  it("3. N=3 C=2 → 2 customs + 1 officiel", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: customs(2),
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(countCustoms(built), 2);
    assert.equal(countOfficials(built), 1);
  });

  it("4. N=3 C=3 → 3 customs uniquement", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: customs(3),
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(countCustoms(built), 3);
    assert.equal(countOfficials(built), 0);
  });

  it("5. N=3 C=5 → 3 customs tirés ; 2 non consommés", () => {
    const cu = customs(5);
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: cu,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(countCustoms(built), 3);
    assert.equal(countOfficials(built), 0);
    assert.equal(built.consumedCustomTopicIds.length, 3);
    const left = filterUnconsumedCustomTopics(cu, built.consumedCustomTopicIds);
    assert.equal(left.length, 2);
  });

  it("6. N=5 C=2 → 2 customs + 3 officiels", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: customs(2),
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 5,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(countCustoms(built), 2);
    assert.equal(countOfficials(built), 3);
  });

  it("7. N=8 C=3 → 3 customs + 5 officiels", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: customs(3),
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 8,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(built.queue.length, 8);
    assert.equal(countCustoms(built), 3);
    assert.equal(countOfficials(built), 5);
  });

  it("8. pool insuffisant → rejet", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL.slice(0, 1),
      customTopics: customs(1),
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 5,
      rng: () => 0,
    });
    assert.equal(built.ok, false);
    assert.equal(built.code, "INSUFFICIENT_TOPICS");
  });

  it("9. categoryIds=['*'] catalogue complet éligible", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: [],
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 5,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(built.queue.length, 5);
  });

  it("10. catégories explicites → seuls officiels filtrés", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: customs(1),
      categoryIds: ["survival"],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(countCustoms(built), 1);
    for (const e of built.queue) {
      if (!e.topicSnapshot.custom) {
        assert.equal(e.topicSnapshot.categoryId, "survival");
      }
    }
  });

  it("11. categoryId inconnu → rejet (pas customs-only silencieux)", () => {
    const v = validateTierNightSeriesCategoryIds(["not-a-real-cat"]);
    assert.equal(v.ok, false);
    assert.equal(v.code, "UNKNOWN_CATEGORY_ID");

    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: customs(5),
      categoryIds: ["not-a-real-cat"],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, false);
    assert.equal(built.code, "UNKNOWN_CATEGORY_ID");

    const launch = validateTierNightSeriesSetupForLaunch(
      { path: "series", categoryIds: ["ghost"], roundCount: 3 },
      { customTopics: customs(5) }
    );
    assert.equal(launch.ok, false);
    assert.equal(launch.code, "UNKNOWN_CATEGORY_ID");
  });

  it("12. customs consommés exclus", () => {
    const cu = customs(3);
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: cu,
      excludeCustomIds: [cu[0].id],
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(
      built.queue.some((e) => e.topicSnapshot.id === cu[0].id),
      false
    );
  });

  it("13. C>N → consumed = uniquement tirés", () => {
    const cu = customs(5);
    const built = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: cu,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0,
    });
    assert.deepEqual(
      built.consumedCustomTopicIds,
      listConsumedCustomTopicIdsFromSeries({ queue: built.queue })
    );
    assert.equal(built.consumedCustomTopicIds.length, 3);
  });

  it("14–15. snapshots / roundId / longueur / pas de doublon", () => {
    const built = buildTierNightSeriesQueue({
      runId: "run-x",
      topics: OFFICIAL,
      customTopics: customs(2),
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 5,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(built.queue.length, 5);
    const ids = topicIds(built);
    assert.equal(new Set(ids).size, 5);
    built.queue.forEach((e, i) => {
      assert.equal(e.roundIndex, i);
      assert.equal(e.roundId, `run-x:${i}`);
      assert.ok(e.topicId.startsWith("roster:"));
      assert.equal(e.topicSnapshot.id, e.topicId.slice("roster:".length));
      if (isCustomId(e.topicSnapshot.id)) {
        assert.equal(e.topicSnapshot.custom, true);
        assert.equal(e.topicSnapshot.emoji, "");
      }
    });
  });
});

describe("BUG-TIERNIGHT-SERIES-QA-01 - fin série clôture", () => {
  it("POST_GAME inclut tiernight-end ; complete AH allowlist SQL", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /POST_GAME_SCREENS = new Set\(\[[^\]]*tiernight-end/);
    assert.match(sync, /tiernight-end/);
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /ensureTierNightSeriesSessionCompleted/);
    assert.match(play, /phase === "series_end"/);
    const end = read("js/screens/tierNightEnd.js");
    assert.match(end, /btn-tiernight-end-continue/);
    assert.match(end, /Autre jeu/);
    assert.match(
      end,
      /primaryCta = isSeriesEnd\s*\?[\s\S]*?Autre jeu[\s\S]*?Voir les résultats/
    );
    const sql = read("supabase/bug-tiernight-series-qa-01-complete-screen.sql");
    assert.match(sql, /tiernight-end/);
    assert.match(sql, /complete_game_session_as_actor/);
  });

  it("helpers exportés / pas de shuffle global pool→slice", () => {
    const series = read("js/core/tierNightSeries.js");
    assert.match(series, /buildCombinedShuffledDeck/);
    assert.doesNotMatch(
      series,
      /fisherYatesShuffle\(eligible[\s\S]*?\)\.slice\(0,\s*count\)/
    );
  });
});
