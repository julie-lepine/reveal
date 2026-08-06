/**
 * FEATURE-TIERNIGHT-03-A1-bis — types JSON stricts + smokes codes métier.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_NIGHT_SERIES_SQL_SHAPE_CODES,
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  validateTierNightSeries,
  validateTierNightSeriesCategoryIdsShape,
} from "../js/core/tierNightSeries.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";
import { ROSTER_TOPIC_PREFIX } from "../js/core/rosterTopic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BIS_SQL = readFileSync(
  join(ROOT, "supabase/feature-tiernight-03-a1bis-series-shape-strict.sql"),
  "utf8"
);
const RUNBOOK = readFileSync(
  join(ROOT, "supabase/feature-tiernight-03-a1bis-series-shape-strict-runbook.sql"),
  "utf8"
);

function extractBody(sql) {
  const start = sql.indexOf(
    "create or replace function public.tiernight_series_validate_series_shape"
  );
  const end = sql.indexOf("comment on function public.tiernight_series_validate_series_shape", start);
  assert.ok(start >= 0 && end > start);
  return sql.slice(start, end);
}

function baseValidSeries() {
  const built = buildTierNightSeriesQueue({
    runId: "run-bis",
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
    runId: "run-bis",
    categoryIds: ["*"],
    roundCount: 3,
    queue: built.queue,
  });
  assert.equal(created.ok, true, created.code);
  return created.series;
}

describe("FEATURE-TIERNIGHT-03-A1-bis - SQL source", () => {
  it("codes nouveaux présents + filet SHAPE_EXCEPTION", () => {
    const body = extractBody(BIS_SQL);
    for (const code of [
      "TNS_SNAPSHOT_ID_TYPE",
      "TNS_SNAPSHOT_NAME_TYPE",
      "TNS_CUSTOM_FLAG_INVALID",
      "TNS_LEDGER_INVALID_ENTRY",
      "TNS_SHAPE_EXCEPTION",
    ]) {
      assert.match(body, new RegExp(code));
    }
    assert.match(body, /jsonb_typeof\(v_id_node\) <> 'string'/);
    assert.match(body, /jsonb_typeof\(v_name_node\) <> 'string'/);
    assert.match(body, /not \(v_snap \? 'custom'\)/);
    assert.match(body, /TNS_LEDGER_INVALID_ENTRY/);
    assert.match(body, /star_mixed/);
    assert.equal(/\braise\s+exception\b/i.test(body), false);
  });

  it("catalogue JS ⊆ SQL A1-bis", () => {
    for (const code of TIER_NIGHT_SERIES_SQL_SHAPE_CODES) {
      assert.match(BIS_SQL, new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("runbook documente smokes métier ≠ SHAPE_EXCEPTION", () => {
    assert.match(RUNBOOK, /JAMAIS TNS_SHAPE_EXCEPTION/);
    assert.match(RUNBOOK, /TNS_SNAPSHOT_ID_TYPE/);
    assert.match(RUNBOOK, /TNS_CUSTOM_FLAG_INVALID/);
    assert.match(RUNBOOK, /TNS_LEDGER_INVALID_ENTRY/);
    assert.match(RUNBOOK, /TNS_INVALID_CATEGORY_IDS/);
  });
});

describe("FEATURE-TIERNIGHT-03-A1-bis - snapshot id/name types", () => {
  it("id nombre → SNAPSHOT_ID_TYPE (pas coercion)", () => {
    const s = baseValidSeries();
    s.queue[0].topicSnapshot = {
      ...s.queue[0].topicSnapshot,
      id: 123,
    };
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "SNAPSHOT_ID_TYPE");
  });

  it("name bool → SNAPSHOT_NAME_TYPE", () => {
    const s = baseValidSeries();
    s.queue[0].topicSnapshot = {
      ...s.queue[0].topicSnapshot,
      name: true,
    };
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "SNAPSHOT_NAME_TYPE");
  });

  it("id/name strings vides → INCOMPLETE_SNAPSHOT", () => {
    const s = baseValidSeries();
    s.queue[0].topicSnapshot = {
      ...s.queue[0].topicSnapshot,
      name: "   ",
    };
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "INCOMPLETE_SNAPSHOT");
  });
});

describe("FEATURE-TIERNIGHT-03-A1-bis - custom flag", () => {
  it("chaînes arbitraires rejetées", () => {
    for (const bad of ["banana", "yes", "0", "TRUE "]) {
      // "TRUE " after trim/lower is "true" — actually allowed. Use banana.
      void bad;
    }
    const s = baseValidSeries();
    for (const bad of ["banana", "yes", "0"]) {
      s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: bad };
      assert.equal(
        validateTierNightSeries(s, { runId: "run-bis" }).code,
        "CUSTOM_FLAG_INVALID",
        bad
      );
    }
  });

  it("legacy string false/f acceptées sur officiel", () => {
    const s = baseValidSeries();
    s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: "false" };
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).ok, true);
    s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: "f" };
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).ok, true);
  });

  it("absent sur officiel = OK ; null = CUSTOM_FLAG_INVALID", () => {
    const s = baseValidSeries();
    const snap = { ...s.queue[0].topicSnapshot };
    delete snap.custom;
    s.queue[0].topicSnapshot = snap;
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).ok, true);

    s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: null };
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "CUSTOM_FLAG_INVALID");
  });

  it("wire custom sans champ custom → INCONSISTENT", () => {
    const s = baseValidSeries();
    const id = `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}z`;
    s.queue[0].topicId = `${ROSTER_TOPIC_PREFIX}${id}`;
    s.queue[0].topicSnapshot = {
      id,
      name: "Custom Z",
      emoji: "",
      categoryId: "",
    };
    assert.equal(
      validateTierNightSeries(s, { runId: "run-bis" }).code,
      "CUSTOM_SNAPSHOT_INCONSISTENT"
    );
  });

  it("custom entier / objet → CUSTOM_FLAG_INVALID", () => {
    const s = baseValidSeries();
    s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: 1 };
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "CUSTOM_FLAG_INVALID");
    s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: { x: 1 } };
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "CUSTOM_FLAG_INVALID");
  });
});

describe("FEATURE-TIERNIGHT-03-A1-bis - ledgers", () => {
  it("entier dans ledger → LEDGER_INVALID_ENTRY", () => {
    const s = baseValidSeries();
    s.scoredRoundIds = [1];
    s.completedRoundIds = [];
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "LEDGER_INVALID_ENTRY");
  });

  it("objet dans ledger → LEDGER_INVALID_ENTRY", () => {
    const s = baseValidSeries();
    s.completedRoundIds = [{ id: "run-bis:0" }];
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "LEDGER_INVALID_ENTRY");
  });

  it("scored ⊈ completed → LEDGER_SCORED_NOT_COMPLETED", () => {
    const s = baseValidSeries();
    s.scoredRoundIds = ["run-bis:0"];
    s.completedRoundIds = [];
    assert.equal(
      validateTierNightSeries(s, { runId: "run-bis" }).code,
      "LEDGER_SCORED_NOT_COMPLETED"
    );
  });
});

describe("FEATURE-TIERNIGHT-03-A1-bis - categoryIds", () => {
  it("contrat shape SQL/JS", () => {
    assert.equal(validateTierNightSeriesCategoryIdsShape([]).ok, false);
    assert.equal(validateTierNightSeriesCategoryIdsShape([1]).ok, false);
    assert.equal(validateTierNightSeriesCategoryIdsShape([""]).ok, false);
    assert.equal(validateTierNightSeriesCategoryIdsShape(["*", "survival"]).ok, false);
    assert.equal(validateTierNightSeriesCategoryIdsShape(["social", "social"]).ok, false);
    assert.equal(validateTierNightSeriesCategoryIdsShape(["*"]).ok, true);
    assert.equal(validateTierNightSeriesCategoryIdsShape(["survival", "social"]).ok, true);
  });

  it("série avec categoryIds star_mixed rejetée", () => {
    const s = baseValidSeries();
    s.categoryIds = ["*", "survival"];
    assert.equal(validateTierNightSeries(s, { runId: "run-bis" }).code, "INVALID_CATEGORY_IDS");
  });
});

describe("FEATURE-TIERNIGHT-03-A1-bis - smokes métier (miroir SQL)", () => {
  /**
   * Ces cas prouvent que les erreurs connues ont un code métier précis
   * (équivalent JS du contrat SQL — le filet TNS_SHAPE_EXCEPTION n'est pas utilisé).
   */
  const cases = [
    ["id number", (s) => {
      s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, id: 123 };
      return "SNAPSHOT_ID_TYPE";
    }],
    ["name bool", (s) => {
      s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, name: true };
      return "SNAPSHOT_NAME_TYPE";
    }],
    ["custom banana", (s) => {
      s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: "banana" };
      return "CUSTOM_FLAG_INVALID";
    }],
    ["custom int", (s) => {
      s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: 0 };
      return "CUSTOM_FLAG_INVALID";
    }],
    ["custom object", (s) => {
      s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: {} };
      return "CUSTOM_FLAG_INVALID";
    }],
    ["custom null", (s) => {
      s.queue[0].topicSnapshot = { ...s.queue[0].topicSnapshot, custom: null };
      return "CUSTOM_FLAG_INVALID";
    }],
    ["ledger int", (s) => {
      s.scoredRoundIds = [0];
      return "LEDGER_INVALID_ENTRY";
    }],
    ["ledger object", (s) => {
      s.completedRoundIds = [{}];
      return "LEDGER_INVALID_ENTRY";
    }],
    ["categoryIds mix", (s) => {
      s.categoryIds = ["*", "survival"];
      return "INVALID_CATEGORY_IDS";
    }],
  ];

  for (const [label, mut] of cases) {
    it(`cas « ${label} » → code métier (pas SHAPE_EXCEPTION)`, () => {
      const s = baseValidSeries();
      const expected = mut(s);
      const res = validateTierNightSeries(s, { runId: "run-bis" });
      assert.equal(res.ok, false);
      assert.equal(res.code, expected);
      assert.notEqual(res.code, "SHAPE_EXCEPTION");
      assert.notEqual(res.code, "TNS_SHAPE_EXCEPTION");
    });
  }
});
