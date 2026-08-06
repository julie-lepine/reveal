/**
 * FEATURE-TIERNIGHT-03-A1 — preuves SQL shape totale + one-shot + codes contrat.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_NIGHT_SERIES_ONE_SHOT_CONTRACT,
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  filterUnconsumedCustomTopics,
  listConsumedCustomTopicIdsFromSeries,
  mergeConsumedCustomTopicIds,
  validateTierNightSeries,
} from "../js/core/tierNightSeries.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";
import { ROSTER_TOPIC_PREFIX } from "../js/core/rosterTopic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const A1_SQL = readFileSync(
  join(ROOT, "supabase/feature-tiernight-03-a1-series-shape-total.sql"),
  "utf8"
);
const A_SQL = readFileSync(
  join(ROOT, "supabase/feature-tiernight-03-series-contract.sql"),
  "utf8"
);

function extractShapeBody(sql) {
  const start = sql.indexOf(
    "create or replace function public.tiernight_series_validate_series_shape"
  );
  assert.ok(start >= 0);
  const end = sql.indexOf("comment on function public.tiernight_series_validate_series_shape", start);
  assert.ok(end > start);
  return sql.slice(start, end);
}

describe("FEATURE-TIERNIGHT-03-A1 - SQL total", () => {
  it("filet exception outer → TNS_SHAPE_EXCEPTION (pas de raise nu)", () => {
    const body = extractShapeBody(A1_SQL);
    assert.match(body, /TNS_SHAPE_EXCEPTION/);
    assert.match(body, /exception when others then/);
    // Aucun raise exception dans le corps du validateur
    assert.equal(/\braise\s+exception\b/i.test(body), false);
  });

  it("casts version / roundIndex entry protégés", () => {
    const body = extractShapeBody(A1_SQL);
    assert.match(body, /v_version := \(p_series ->> 'version'\)::int/);
    assert.match(body, /v_entry_index := \(v_entry ->> 'roundIndex'\)::int/);
    assert.match(body, /TNS_UNSUPPORTED_VERSION/);
    assert.match(body, /TNS_ROUND_INDEX_DISCONTINUITY/);
  });

  it("categoryIds requis + counts 3/5/7/8", () => {
    const body = extractShapeBody(A1_SQL);
    assert.match(body, /TNS_INVALID_CATEGORY_IDS/);
    assert.match(body, /array\[3, 5, 7, 8\]/);
  });

  it("customs : bool JSON + string ; type invalide → inconsistent", () => {
    const body = extractShapeBody(A1_SQL);
    assert.match(body, /jsonb_typeof\(v_custom_node\) = 'boolean'/);
    assert.match(body, /TNS_CUSTOM_SNAPSHOT_INCONSISTENT/);
    assert.equal(/TNS_CUSTOM_IN_SERIES_QUEUE/.test(body), false);
  });

  it("ACL helper : revoke authenticated (pas grant client)", () => {
    assert.match(A1_SQL, /revoke all on function public\.tiernight_series_validate_series_shape/);
    assert.match(
      A1_SQL,
      /revoke all on function public\.tiernight_series_validate_series_shape\(jsonb, text\) from authenticated/i
    );
    assert.equal(
      /grant execute on function public\.tiernight_series_validate_series_shape\(jsonb, text\) to authenticated/i.test(
        A1_SQL
      ),
      false
    );
  });

  it("A pointe vers A1 obligatoire ; A ne grant plus authenticated", () => {
    assert.match(A_SQL, /feature-tiernight-03-a1-series-shape-total/);
    assert.match(
      A_SQL,
      /revoke all on function public\.tiernight_series_validate_series_shape\(jsonb, text\) from authenticated/i
    );
  });

  it("catalogue de codes A1 présents dans SQL A1 (sous-ensemble)", () => {
    const a1Codes = [
      "TNS_NO_SERIES",
      "TNS_UNSUPPORTED_VERSION",
      "TNS_INVALID_CATEGORY_IDS",
      "TNS_CUSTOM_SNAPSHOT_INCONSISTENT",
      "TNS_SHAPE_EXCEPTION",
    ];
    for (const code of a1Codes) {
      assert.match(A1_SQL, new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

describe("FEATURE-TIERNIGHT-03-A1 - one-shot lifecycle", () => {
  it("contrat documenté : pas de mutation lobby, snapshot survit", () => {
    assert.equal(TIER_NIGHT_SERIES_ONE_SHOT_CONTRACT.mutatesLobbyCustoms, false);
    assert.equal(TIER_NIGHT_SERIES_ONE_SHOT_CONTRACT.snapshotSurvivesLobbyDelete, true);
    assert.equal(TIER_NIGHT_SERIES_ONE_SHOT_CONTRACT.excludeParam, "excludeCustomIds");
    assert.equal(TIER_NIGHT_SERIES_ONE_SHOT_CONTRACT.persistEvening, "pending_step_b");
  });

  it("consommation = membership queue ; lobby array intact", () => {
    const customs = [
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a`, name: "A", custom: true },
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}b`, name: "B", custom: true },
    ];
    const before = JSON.stringify(customs);
    const built = buildTierNightSeriesQueue({
      runId: "r-life",
      topics: [
        { id: "o1", name: "O1", emoji: "1", categoryId: "survival", enabled: true },
        { id: "o2", name: "O2", emoji: "2", categoryId: "survival", enabled: true },
      ],
      customTopics: customs,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    assert.equal(JSON.stringify(customs), before);
    const consumed = listConsumedCustomTopicIdsFromSeries({ queue: built.queue });
    assert.ok(consumed.length >= 1);
    assert.deepEqual(built.consumedCustomTopicIds, consumed);

    const nextPool = filterUnconsumedCustomTopics(customs, consumed);
    assert.equal(nextPool.length, customs.length - consumed.length);
    for (const id of consumed) {
      assert.ok(!nextPool.some((t) => t.id === id));
    }

    const merged = mergeConsumedCustomTopicIds(["pre-existing"], { queue: built.queue });
    assert.ok(merged.includes("pre-existing"));
    for (const id of consumed) assert.ok(merged.includes(id));
  });

  it("deuxième build avec excludeCustomIds n’inclut pas les consommés", () => {
    const customs = [
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`, name: "X only", custom: true },
    ];
    const official = [
      { id: "a", name: "A", emoji: "a", categoryId: "survival", enabled: true },
      { id: "b", name: "B", emoji: "b", categoryId: "survival", enabled: true },
      { id: "c", name: "C", emoji: "c", categoryId: "survival", enabled: true },
    ];
    const first = buildTierNightSeriesQueue({
      runId: "r1",
      topics: official,
      customTopics: customs,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(first.ok, true);
    assert.ok(first.consumedCustomTopicIds.includes(`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`));

    const second = buildTierNightSeriesQueue({
      runId: "r2",
      topics: official,
      customTopics: customs,
      excludeCustomIds: first.consumedCustomTopicIds,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(second.ok, true);
    assert.equal(
      second.queue.some((e) => e.topicSnapshot.id === `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`),
      false
    );
  });
});

describe("FEATURE-TIERNIGHT-03-A1 - JS validate aligné", () => {
  function baseSeries(overrides = {}) {
    const built = buildTierNightSeriesQueue({
      runId: "run-a1",
      topics: [
        { id: "a1", name: "A1", emoji: "1", categoryId: "survival", enabled: true },
        { id: "a2", name: "A2", emoji: "2", categoryId: "survival", enabled: true },
        { id: "a3", name: "A3", emoji: "3", categoryId: "survival", enabled: true },
      ],
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0,
    });
    const created = createTierNightSeriesState({
      runId: "run-a1",
      categoryIds: ["*"],
      roundCount: 3,
      queue: built.queue,
    });
    assert.equal(created.ok, true);
    return { ...created.series, ...overrides };
  }

  it("custom string 'true' accepté si wire custom", () => {
    const s = baseSeries();
    const id = `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}s`;
    s.queue[0].topicId = `${ROSTER_TOPIC_PREFIX}${id}`;
    s.queue[0].topicSnapshot = {
      id,
      name: "S",
      emoji: "",
      categoryId: "",
      custom: "true",
    };
    assert.equal(validateTierNightSeries(s, { runId: "run-a1" }).ok, true);
  });

  it("custom number → CUSTOM_FLAG_INVALID", () => {
    const s = baseSeries();
    s.queue[0].topicSnapshot = {
      ...s.queue[0].topicSnapshot,
      custom: 1,
    };
    assert.equal(
      validateTierNightSeries(s, { runId: "run-a1" }).code,
      "CUSTOM_FLAG_INVALID"
    );
  });

  it("categoryIds non-array → INVALID_CATEGORY_IDS", () => {
    const s = baseSeries({ categoryIds: "survival" });
    assert.equal(validateTierNightSeries(s, { runId: "run-a1" }).code, "INVALID_CATEGORY_IDS");
  });
});
