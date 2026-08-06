/**
 * FEATURE-TIERNIGHT-03-D1-bis — round_result Option A + consolidation SQL.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_NIGHT_SERIES_PHASES,
  TIER_NIGHT_SERIES_RETIRED_PHASES,
  isRetiredTierNightSeriesPhase,
  validateTierNightSeries,
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
} from "../js/core/tierNightSeries.js";
import { TIER_NIGHT_ROSTER_TOPICS } from "../data/tierTopics.js";
import { isTierNightSeriesUiEnabled } from "../js/core/tierNightSeriesGate.js";

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

const {
  resolveTierNightSeriesScreenFromPhase,
  canAdvanceTierNightSeriesFromPhase,
  resolveRetiredTierNightSeriesPhase,
  assertCanAdvanceTierNightSeriesRound,
  assertCanFinalizeTierNightSeriesRound,
  mapTierNightSeriesRpcErrorToUx,
} = await import("../js/core/tierNightSeriesPlaySession.js");

function makeBetween(runId) {
  const built = buildTierNightSeriesQueue({
    runId,
    topics: TIER_NIGHT_ROSTER_TOPICS,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount: 3,
    rng: () => 0,
  });
  const created = createTierNightSeriesState({
    runId,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount: 3,
    queue: built.queue,
  });
  return {
    ...created.series,
    phase: "between_rounds",
    roundIndex: 0,
    scoredRoundIds: [`${runId}:0`],
    completedRoundIds: [`${runId}:0`],
    roundHistory: [{ roundId: `${runId}:0`, roundIndex: 0 }],
    roundRecap: { roundId: `${runId}:0`, roundIndex: 0 },
  };
}

describe("FEATURE-TIERNIGHT-03-D1-bis - Option A round_result", () => {
  it("origine documentée : SERIES-00 prévue, jamais écrite par finalize", () => {
    const fin = read("supabase/feature-tiernight-series-03a-finalize-round-hardening.sql");
    assert.match(
      fin,
      /v_next_phase := case when v_is_last then 'series_end' else 'between_rounds'/
    );
    assert.doesNotMatch(fin, /v_next_phase := 'round_result'|phase',\s*'round_result'/);
    const d1bis = read("supabase/feature-tiernight-03-d1bis-series-shape-canonical.sql");
    assert.match(d1bis, /SERIES-00|jamais écrite|Option A/i);
  });

  it("phases canoniques sans round_result ; retired list", () => {
    assert.deepEqual([...TIER_NIGHT_SERIES_PHASES], [
      "ranking",
      "between_rounds",
      "series_end",
    ]);
    assert.ok(TIER_NIGHT_SERIES_RETIRED_PHASES.includes("round_result"));
    assert.equal(isRetiredTierNightSeriesPhase("round_result"), true);
    assert.equal(isRetiredTierNightSeriesPhase("between_rounds"), false);
  });

  it("état round_result : validate PHASE_RETIRED + screen null + pas d’impasse", () => {
    const runId = "d1bis-rr";
    const rr = { ...makeBetween(runId), phase: "round_result" };
    const v = validateTierNightSeries(rr, { runId });
    assert.equal(v.ok, false);
    assert.equal(v.code, "PHASE_RETIRED");

    assert.equal(resolveTierNightSeriesScreenFromPhase("round_result"), null);
    assert.equal(canAdvanceTierNightSeriesFromPhase("round_result"), false);

    const exit = resolveRetiredTierNightSeriesPhase("round_result");
    assert.equal(exit.ok, false);
    assert.equal(exit.retired, true);
    assert.equal(exit.deadEnd, false);
    assert.equal(exit.code, "TNS_PHASE_RETIRED");

    const adv = assertCanAdvanceTierNightSeriesRound({ runId, series: rr });
    assert.equal(adv.ok, false);
    // validate échoue avant phase advance
    assert.ok(adv.code === "PHASE_RETIRED" || adv.validation === true);

    const fin = assertCanFinalizeTierNightSeriesRound({ runId, series: rr });
    assert.equal(fin.ok, false);
  });

  it("between_rounds reste jouable (CTA possible)", () => {
    const runId = "d1bis-ok";
    const between = makeBetween(runId);
    const v = validateTierNightSeries(between, { runId });
    assert.equal(v.ok, true, v.code);
    assert.equal(resolveTierNightSeriesScreenFromPhase("between_rounds"), "tiernight-between");
    assert.equal(canAdvanceTierNightSeriesFromPhase("between_rounds"), true);
    const adv = assertCanAdvanceTierNightSeriesRound({ runId, series: between });
    assert.equal(adv.ok, true);
  });

  it("UI between redirige round_result hors sync deadlock", () => {
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /phase === "round_result"/);
    assert.match(between, /tiernight-prep/);
    assert.doesNotMatch(between, /synchronisation…/);
  });

  it("UX map TNS_PHASE_RETIRED", () => {
    const ux = mapTierNightSeriesRpcErrorToUx("TNS_PHASE_RETIRED");
    assert.equal(ux.terminal, true);
    assert.equal(ux.retry, false);
    assert.match(ux.message, /obsolète|prep/i);
  });

  it("gate OFF", () => {
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});

describe("FEATURE-TIERNIGHT-03-D1-bis - SQL consolidation", () => {
  it("migration D1-bis présente : A1-bis + phases sans round_result", () => {
    const sql = read("supabase/feature-tiernight-03-d1bis-series-shape-canonical.sql");
    assert.match(sql, /create or replace function public\.tiernight_series_validate_series_shape/);
    assert.match(sql, /array\['ranking', 'between_rounds', 'series_end'\]/);
    assert.match(sql, /array\[3,\s*5,\s*7,\s*8\]/);
    assert.match(sql, /TNS_SNAPSHOT_ID_TYPE/);
    assert.match(sql, /D1-bis/);
    const body = sql.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(body, /'round_result'/);
  });

  it("ordre final : D1-bis après A1-bis ; RPCs finalize/advance non créées ici", () => {
    const sql = read("supabase/feature-tiernight-03-d1bis-series-shape-canonical.sql");
    assert.doesNotMatch(
      sql,
      /create or replace function public\.(finalize_tiernight_series_round|advance_tiernight_series_round)/i
    );
    assert.match(sql, /DERNIER|dernier/i);
  });

  it("runbook D1-bis pointe harness ; harness couvre F/A/L/C/R + isolation", () => {
    const rb = read("supabase/feature-tiernight-03-d1bis-smoke-runbook.sql");
    assert.match(rb, /d1bis-smoke-harness/);
    assert.match(rb, /v-rec-scope-fix/);
    assert.match(rb, /R2–R5 autonome|AUTONOME/);
    const harness = read("supabase/feature-tiernight-03-d1bis-smoke-harness.sql");
    assert.match(harness, /tnsd1b_spawn_fixture/);
    assert.match(harness, /R2_RUNID_DRIFT/);
    assert.match(harness, /must NOT be TNS_STALE_RUN/);
    assert.match(harness, /finalize mutated state/);
    assert.match(harness, /advance mutated state/);
    assert.match(harness, /BLOC AUTONOME/);
  });

  it("fix v_rec scope : finalize n’utilise plus v_rec.elem", () => {
    const fix = read("supabase/feature-tiernight-03-d1bis-finalize-v-rec-scope-fix.sql");
    const o3a = read("supabase/feature-tiernight-series-03a-finalize-round-hardening.sql");
    for (const src of [fix, o3a]) {
      const body = src.replace(/--[^\n]*/g, "");
      assert.doesNotMatch(body, /v_rec\.elem/);
      assert.match(src, /for v_rec in select value from jsonb_array_elements\(v_recaps\)/);
      assert.match(src, /v_rec ->> 'uid'/);
    }
  });

  it("alignement source JS phases = SQL D1-bis", () => {
    const sql = read("supabase/feature-tiernight-03-d1bis-series-shape-canonical.sql");
    for (const p of TIER_NIGHT_SERIES_PHASES) {
      assert.match(sql, new RegExp(`'${p}'`));
    }
  });
});
