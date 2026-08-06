/**
 * FEATURE-TIERNIGHT-03-A — contrat moteur : 3/5/8, customs one-shot, snapshots.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  TIER_NIGHT_SERIES_ROUND_COUNTS,
  TIER_NIGHT_SERIES_LEGACY_ROUND_COUNTS,
  buildTierNightSeriesQueue,
  buildTierNightSeriesTopicPool,
  countTierNightSeriesTopicPool,
  createTierNightSeriesState,
  filterUnconsumedCustomTopics,
  listConsumedCustomTopicIdsFromSeries,
  mergeConsumedCustomTopicIds,
  normalizeTierNightSeries,
  snapshotTierNightSeriesTopic,
  validateTierNightSeries,
} from "../js/core/tierNightSeries.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";
import { ROSTER_TOPIC_PREFIX } from "../js/core/rosterTopic.js";
import { prepareTierNightSeriesLaunchAttempt } from "../js/core/tierNightSeriesLaunch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function identityShuffleRng() {
  return () => 0;
}

const OFFICIAL = [
  { id: "o1", name: "Off 1", emoji: "1", categoryId: "survival", enabled: true },
  { id: "o2", name: "Off 2", emoji: "2", categoryId: "survival", enabled: true },
  { id: "o3", name: "Off 3", emoji: "3", categoryId: "survival", enabled: true },
  { id: "o4", name: "Off 4", emoji: "4", categoryId: "social", enabled: true },
  { id: "o5", name: "Off 5", emoji: "5", categoryId: "chaos", enabled: true },
];

const CUSTOMS = [
  { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c1`, name: "Custom one", custom: true },
  { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c2`, name: "Custom two", custom: true },
  { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c3`, name: "Custom three", custom: true },
];

describe("FEATURE-TIERNIGHT-03-A - counts", () => {
  it("autorise uniquement 3, 5, 8 pour les nouvelles séries", () => {
    assert.deepEqual([...TIER_NIGHT_SERIES_ROUND_COUNTS], [3, 5, 8]);
    assert.deepEqual([...TIER_NIGHT_SERIES_LEGACY_ROUND_COUNTS], [7]);
  });

  it("build refuse 7 et accepte 8", () => {
    const bad = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: CUSTOMS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 7,
      rng: identityShuffleRng(),
    });
    assert.equal(bad.code, "INVALID_ROUND_COUNT");

    const ok = buildTierNightSeriesQueue({
      runId: "r",
      topics: OFFICIAL,
      customTopics: CUSTOMS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 8,
      rng: identityShuffleRng(),
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.queue.length, 8);
  });
});

describe("FEATURE-TIERNIGHT-03-A - pool + deck", () => {
  it("catalogue seul + customs + dédup par id", () => {
    const pool = buildTierNightSeriesTopicPool({
      topics: OFFICIAL,
      customTopics: [
        ...CUSTOMS,
        { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c1`, name: "dup", custom: true },
        { id: "o1", name: "fake official id as custom", custom: true },
      ],
      categoryIds: ["survival"],
    });
    // survival officiels = 3 ; customs c1/c2/c3 (o1 custom rejected by prefix filter)
    assert.equal(pool.length, 6);
    assert.equal(new Set(pool.map((t) => t.id)).size, 6);
  });

  it("Tout le catalogue + customs", () => {
    assert.equal(
      countTierNightSeriesTopicPool({
        topics: OFFICIAL,
        customTopics: CUSTOMS,
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      }),
      8
    );
  });

  it("deck insuffisant sans wrap / sans doublon", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r-insuf",
      topics: OFFICIAL.slice(0, 2),
      customTopics: [],
      roundCount: 5,
      rng: identityShuffleRng(),
    });
    assert.equal(built.ok, false);
    assert.equal(built.code, "INSUFFICIENT_TOPICS");
    assert.equal(built.available, 2);
  });

  it("shuffle avant slice + sources non mutées", () => {
    const beforeOff = JSON.stringify(OFFICIAL);
    const beforeCu = JSON.stringify(CUSTOMS);
    const a = buildTierNightSeriesQueue({
      runId: "r-sh",
      topics: OFFICIAL,
      customTopics: CUSTOMS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: (() => {
        let i = 0;
        const vals = [0.9, 0.1, 0.5, 0.2];
        return () => vals[i++ % vals.length];
      })(),
    });
    const b = buildTierNightSeriesQueue({
      runId: "r-sh",
      topics: OFFICIAL,
      customTopics: CUSTOMS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: (() => {
        let i = 0;
        const vals = [0.9, 0.1, 0.5, 0.2];
        return () => vals[i++ % vals.length];
      })(),
    });
    assert.equal(a.ok, true);
    assert.deepEqual(
      a.queue.map((e) => e.topicId),
      b.queue.map((e) => e.topicId)
    );
    assert.equal(JSON.stringify(OFFICIAL), beforeOff);
    assert.equal(JSON.stringify(CUSTOMS), beforeCu);
  });

  it("aucun doublon dans une série 5", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r5",
      topics: OFFICIAL,
      customTopics: CUSTOMS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 5,
      rng: identityShuffleRng(),
    });
    assert.equal(built.ok, true);
    const ids = built.queue.map((e) => e.topicId);
    assert.equal(new Set(ids).size, 5);
  });
});

describe("FEATURE-TIERNIGHT-03-A - snapshot customs", () => {
  it("snapshot custom : texte + custom true, sans emoji métier", () => {
    const snap = snapshotTierNightSeriesTopic({
      id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}z`,
      name: "Qui est le plus tard ?",
      custom: true,
      emoji: "🚫",
      author: "Alice",
      fn: () => 1,
    });
    assert.deepEqual(snap, {
      id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}z`,
      name: "Qui est le plus tard ?",
      emoji: "",
      categoryId: "",
      custom: true,
    });
  });

  it("queue snapshotée : suppression locale custom n’altère pas la série", () => {
    const customs = [...CUSTOMS];
    const built = buildTierNightSeriesQueue({
      runId: "r-snap",
      topics: OFFICIAL,
      customTopics: customs,
      categoryIds: ["survival"],
      roundCount: 5,
      rng: identityShuffleRng(),
    });
    assert.equal(built.ok, true);
    const created = createTierNightSeriesState({
      runId: "r-snap",
      categoryIds: ["survival"],
      roundCount: 5,
      queue: built.queue,
    });
    assert.equal(created.ok, true);

    const customEntry = created.series.queue.find((e) => e.topicSnapshot.custom);
    assert.ok(customEntry);
    const frozenName = customEntry.topicSnapshot.name;

    customs.length = 0; // purge lobby
    const again = validateTierNightSeries(created.series, { runId: "r-snap" });
    assert.equal(again.ok, true);
    assert.equal(
      again.series.queue.find((e) => e.topicId === customEntry.topicId).topicSnapshot.name,
      frozenName
    );
  });

  it("invité sans custom local voit le texte via snapshot", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r-guest",
      topics: OFFICIAL,
      customTopics: CUSTOMS.slice(0, 1),
      categoryIds: ["survival"],
      roundCount: 3,
      rng: identityShuffleRng(),
    });
    const hydrate = normalizeTierNightSeries(
      createTierNightSeriesState({
        runId: "r-guest",
        categoryIds: ["survival"],
        roundCount: 3,
        queue: built.queue,
      }).series,
      { runId: "r-guest" }
    );
    assert.equal(hydrate.kind, "series");
    const custom = hydrate.series.queue.find((e) => e.topicSnapshot.custom);
    assert.ok(custom);
    assert.equal(custom.topicSnapshot.name, "Custom one");
    assert.match(custom.topicId, new RegExp(`^${ROSTER_TOPIC_PREFIX}${CUSTOM_ROSTER_TOPIC_ID_PREFIX}`));
  });
});

describe("FEATURE-TIERNIGHT-03-A - one-shot customs", () => {
  it("customs tirés sont listés comme consommés", () => {
    const built = buildTierNightSeriesQueue({
      runId: "r-one",
      topics: OFFICIAL.slice(0, 1),
      customTopics: CUSTOMS,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: identityShuffleRng(),
    });
    assert.equal(built.ok, true);
    assert.ok(built.consumedCustomTopicIds.length >= 1);
    assert.deepEqual(
      built.consumedCustomTopicIds,
      listConsumedCustomTopicIdsFromSeries({ queue: built.queue })
    );
  });

  it("excludeCustomIds empêche la réutilisation (one-shot)", () => {
    const first = buildTierNightSeriesQueue({
      runId: "r1",
      topics: OFFICIAL.slice(0, 2),
      customTopics: CUSTOMS,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: identityShuffleRng(),
    });
    assert.equal(first.ok, true);
    const consumed = first.consumedCustomTopicIds;
    assert.ok(consumed.length > 0);

    const remaining = filterUnconsumedCustomTopics(CUSTOMS, consumed);
    assert.equal(remaining.length, CUSTOMS.length - consumed.length);

    const second = buildTierNightSeriesQueue({
      runId: "r2",
      topics: OFFICIAL.slice(0, 2),
      customTopics: CUSTOMS,
      excludeCustomIds: consumed,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: identityShuffleRng(),
    });
    // 2 officiels + customs restants
    if (second.ok) {
      for (const id of consumed) {
        assert.ok(!second.queue.some((e) => e.topicSnapshot.id === id));
      }
    }

    const merged = mergeConsumedCustomTopicIds(consumed, { queue: second.ok ? second.queue : [] });
    assert.ok(merged.length >= consumed.length);
  });

  it("prepare expose consumedCustomTopicIds", () => {
    const prep = prepareTierNightSeriesLaunchAttempt({
      categoryIds: ["survival"],
      roundCount: 3,
      rng: () => 0,
      participants: [
        { userId: "11111111-1111-4111-8111-111111111111", name: "A" },
        { userId: "22222222-2222-4222-8222-222222222222", name: "B" },
      ],
      customTopics: CUSTOMS,
    });
    assert.equal(prep.ok, true, prep.error);
    assert.ok(Array.isArray(prep.attempt.consumedCustomTopicIds));
  });
});

describe("FEATURE-TIERNIGHT-03-A - SQL contrat", () => {
  it("migration 03-A présente et non destructive des fichiers 03A", () => {
    const migration = readFileSync(
      join(ROOT, "supabase/feature-tiernight-03-series-contract.sql"),
      "utf8"
    );
    const hardening = readFileSync(
      join(ROOT, "supabase/feature-tiernight-series-03a-finalize-round-hardening.sql"),
      "utf8"
    );
    assert.match(migration, /array\[3, 5, 7, 8\]/);
    assert.match(migration, /TNS_CUSTOM_SNAPSHOT_INCONSISTENT/);
    assert.match(hardening, /array\[3, 5, 7\]/);
    assert.match(hardening, /TNS_CUSTOM_IN_SERIES_QUEUE/);
  });
});

describe("FEATURE-TIERNIGHT-03-A - legacy mono", () => {
  it("absence de series → legacy", () => {
    const n = normalizeTierNightSeries(null);
    assert.equal(n.kind, "legacy");
  });
});
