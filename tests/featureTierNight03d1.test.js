/**
 * FEATURE-TIERNIGHT-03-D1 — consolidation finalize / apply local / phases / locks.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  validateTierNightSeries,
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
  assertCanFinalizeTierNightSeriesRound,
  assertCanAdvanceTierNightSeriesRound,
  applyAuthoritativeSeriesRpcState,
  buildTierNightSeriesTransitionId,
  mapTierNightSeriesRpcErrorToUx,
  TIER_NIGHT_SERIES_HISTORY_RECAP_CONTRACT,
  TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY,
} = await import("../js/core/tierNightSeriesPlaySession.js");

function makeRankingSeries(runId, roundCount = 3) {
  const built = buildTierNightSeriesQueue({
    runId,
    topics: TIER_NIGHT_ROSTER_TOPICS,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    rng: () => 0,
  });
  assert.equal(built.ok, true);
  return createTierNightSeriesState({
    runId,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    queue: built.queue,
  }).series;
}

function makeBetweenSeries(runId, roundCount, roundIndex) {
  const series = makeRankingSeries(runId, roundCount);
  const scored = [];
  for (let i = 0; i <= roundIndex; i += 1) scored.push(`${runId}:${i}`);
  return {
    ...series,
    phase: "between_rounds",
    roundIndex,
    scoredRoundIds: scored,
    completedRoundIds: [...scored],
    roundHistory: scored.map((id, i) => ({
      roundId: id,
      roundIndex: i,
      topicId: series.queue[i].topicId,
      topicSnapshot: series.queue[i].topicSnapshot,
    })),
    roundRecap: {
      roundId: `${runId}:${roundIndex}`,
      roundIndex,
      topicSnapshot: series.queue[roundIndex].topicSnapshot,
      consensus: { S: ["a"], A: [], B: [], C: [], D: [] },
      recaps: [{ player: "A", consensusPoints: 2, outsiderBonus: 0 }],
    },
  };
}

describe("FEATURE-TIERNIGHT-03-D1 - SQL ordre + runbook", () => {
  it("runbook D1 présent : ordre A1-bis dernier + smokes", () => {
    const rb = read("supabase/feature-tiernight-03-d1-smoke-runbook.sql");
    assert.match(rb, /A1-bis/);
    assert.match(rb, /TOUJOURS DERNIER/);
    assert.match(rb, /finalize_tiernight_series_round/);
    assert.match(rb, /advance_tiernight_series_round/);
    assert.match(rb, /TNS_PLACEMENTS_INCOMPLETE/);
    assert.match(rb, /tierNightsPlayed/);
    assert.match(rb, /PHASE|round_result|between_rounds/);
    assert.match(rb, /À EXÉCUTER manuellement|encore/);
  });

  it("consolidation D1-bis = dernier validateur", () => {
    const d1bis = read("supabase/feature-tiernight-03-d1bis-series-shape-canonical.sql");
    assert.match(d1bis, /D1-bis/);
    assert.match(d1bis, /array\['ranking', 'between_rounds', 'series_end'\]/);
  });

  it("rejeu 03A écrase shape — D1-bis doit être réappliqué en dernier", () => {
    const a1bis = read("supabase/feature-tiernight-03-a1bis-series-shape-strict.sql");
    const o3a = read("supabase/feature-tiernight-series-03a-finalize-round-hardening.sql");
    const d1bis = read("supabase/feature-tiernight-03-d1bis-series-shape-canonical.sql");
    assert.match(a1bis, /create or replace function public\.tiernight_series_validate_series_shape/);
    assert.match(o3a, /create or replace function public\.tiernight_series_validate_series_shape/);
    assert.match(d1bis, /create or replace function public\.tiernight_series_validate_series_shape/);
    assert.match(a1bis, /array\[3,\s*5,\s*7,\s*8\]/);
    assert.match(d1bis, /array\[3,\s*5,\s*7,\s*8\]/);
  });

  it("gate OFF", () => {
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});

describe("FEATURE-TIERNIGHT-03-D1 - force vs all-finished", () => {
  it("SQL : force = roster ∩ finished ∩ placement ; sinon incomplete", () => {
    const sql = read("supabase/feature-tiernight-series-03a-finalize-round-hardening.sql");
    assert.match(sql, /coalesce\(p_force, false\)/);
    assert.match(sql, /TNS_FORCE_NO_FINISHED/);
    assert.match(sql, /TNS_PLACEMENTS_INCOMPLETE/);
    assert.match(sql, /tiernight_series_is_finished_flag/);
  });

  it("board : force = CTA explicite ; auto sans force", () => {
    const game = read("js/games/tierNight.js");
    assert.match(game, /force:\s*true/);
    assert.match(game, /btn-tiernight-force/);
    assert.match(game, /hostFinalizeTierNightSeriesRound\(\{\s*shouldContinue/);
    assert.match(game, /hostFinalizeTierNightSeriesRound\(\{\s*\n\s*force:\s*true/s);
  });

  it("playSession : garde client allFinished avant RPC non-force", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /allTierNightMembersFinished/);
    assert.match(play, /TNS_PLACEMENTS_INCOMPLETE/);
    assert.match(play, /p_force|force,/);
  });
});

describe("FEATURE-TIERNIGHT-03-D1 - apply local sans Realtime", () => {
  it("applyAuthoritativeSeriesRpcState applique phase/scores depuis state RPC", () => {
    const runId = "run-apply";
    const between = makeBetweenSeries(runId, 3, 0);
    const rpcState = {
      tierNight: {
        runId,
        topicId: between.queue[0].topicId,
        lobbyStarted: true,
        series: between,
        playerRoster: [{ userId: "u1", displayName: "A" }],
        items: ["x", "y", "z"],
        placements: { u1: { S: ["x"], A: ["y"], B: ["z"], C: [], D: [] } },
        finished: { u1: true },
      },
      scores: { u1: 5 },
      gameScores: { tiernight: { u1: 5 } },
      playerStats: { u1: { tierConsensusPoints: 5, tierNightsPlayed: 0 } },
      stats: { tierNightsPlayed: 0 },
    };
    const res = applyAuthoritativeSeriesRpcState(rpcState, {
      runId,
      expectScoredRoundId: `${runId}:0`,
    });
    assert.equal(res.ok, true);
    assert.equal(res.phase, "between_rounds");
    assert.equal(res.appliedLocal, true);
  });

  it("refuse stale run / round non scoré", () => {
    const runId = "run-stale";
    const series = makeRankingSeries(runId, 3);
    const bad = applyAuthoritativeSeriesRpcState(
      { tierNight: { runId: "other", series } },
      { runId, expectScoredRoundId: `${runId}:0` }
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "TNS_STALE_RUN");

    const notScored = applyAuthoritativeSeriesRpcState(
      {
        tierNight: {
          runId,
          series: { ...series, phase: "between_rounds", scoredRoundIds: [] },
        },
      },
      { runId, expectScoredRoundId: `${runId}:0` }
    );
    assert.equal(notScored.ok, false);
    assert.equal(notScored.code, "TNS_NOT_SCORED");
  });

  it("hostFinalize applique result.state avant refresh ; soft refresh", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /applyAuthoritativeSeriesRpcState/);
    assert.match(play, /softRefreshAfterLocalApply/);
    assert.match(play, /expectScoredRoundId/);
  });

  it("advance apply expectRoundIndex + ranking", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /expectRoundIndex: nextIndex/);
    assert.match(play, /expectPhase: "ranking"/);
  });
});

describe("FEATURE-TIERNIGHT-03-D1 - round_result retiré (voir D1-bis)", () => {
  it("écran : round_result → null ; advance seulement between_rounds", () => {
    assert.equal(resolveTierNightSeriesScreenFromPhase("round_result"), null);
    assert.equal(canAdvanceTierNightSeriesFromPhase("between_rounds"), true);
    assert.equal(canAdvanceTierNightSeriesFromPhase("round_result"), false);
  });

  it("hydrate round_result : validate refuse (PHASE_RETIRED)", () => {
    const runId = "run-rr";
    const between = makeBetweenSeries(runId, 3, 0);
    const rr = { ...between, phase: "round_result" };
    const validated = validateTierNightSeries(rr, { runId });
    assert.equal(validated.ok, false);
    assert.equal(validated.code, "PHASE_RETIRED");
  });

  it("SQL D1-bis refuse phase ≠ between pour advance ; shape sans round_result", () => {
    const sql = read("supabase/feature-tiernight-series-05-advance-round.sql");
    assert.match(sql, /v_phase is distinct from 'between_rounds'/);
    const d1bis = read("supabase/feature-tiernight-03-d1bis-series-shape-canonical.sql");
    assert.match(d1bis, /array\['ranking', 'between_rounds', 'series_end'\]/);
    assert.doesNotMatch(
      d1bis.replace(/--[^\n]*/g, ""),
      /'round_result'/
    );
  });

  it("UI between : pas de branche synchronisation round_result", () => {
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /canAdvanceTierNightSeriesFromPhase/);
    assert.doesNotMatch(between, /Résultat de manche — synchronisation/);
    assert.match(between, /mapTierNightSeriesRpcErrorToUx/);
  });
});

describe("FEATURE-TIERNIGHT-03-D1 - locks + identité", () => {
  it("transitionId = action|runId|roundId|phase", () => {
    assert.equal(
      buildTierNightSeriesTransitionId("finalize", {
        runId: "r1",
        roundId: "r1:0",
        phase: "ranking",
      }),
      "finalize|r1|r1:0|ranking"
    );
  });

  it("playSession : locks + stale callback guard", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /finalizeTransitionId/);
    assert.match(play, /advanceTransitionId/);
    assert.match(play, /TNS_STALE_CALLBACK/);
    assert.match(play, /buildTierNightSeriesTransitionId/);
  });
});

describe("FEATURE-TIERNIGHT-03-D1 - stats / history / erreurs UX", () => {
  it("tierNightsPlayed uniquement si dernière manche SQL", () => {
    const sql = read("supabase/feature-tiernight-series-03a-finalize-round-hardening.sql");
    assert.match(sql, /if v_is_last then/);
    assert.match(sql, /tierNightsPlayed/);
    assert.match(sql, /ALREADY_APPLIED/);
  });

  it("history/recap contrat : history cumulatif ; recap projection clear advance", () => {
    assert.equal(
      TIER_NIGHT_SERIES_HISTORY_RECAP_CONTRACT.roundHistory,
      "authoritative_cumulative_ledger"
    );
    assert.equal(TIER_NIGHT_SERIES_HISTORY_RECAP_CONTRACT.advanceClearsRoundRecap, true);
    assert.ok(TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY.clear.includes("roundRecap"));
    assert.ok(
      TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY.preserve.includes("series.roundHistory")
    );

    const runId = "run-hist";
    const s = makeBetweenSeries(runId, 3, 0);
    const partial = { ...s };
    delete partial.roundHistory;
    // validate without history still ok if field absent
    const v = validateTierNightSeries(
      { ...s, roundHistory: s.roundHistory },
      { runId }
    );
    assert.equal(v.ok, true);
    assert.equal(v.series.roundHistory.length, 1);
    assert.equal(v.series.roundRecap.roundId, `${runId}:0`);
  });

  it("validate preserve history sur clone sans champ perdu", () => {
    const runId = "run-pres";
    const s = makeBetweenSeries(runId, 3, 0);
    const v = validateTierNightSeries(s, { runId });
    assert.deepEqual(
      v.series.roundHistory.map((h) => h.roundId),
      [`${runId}:0`]
    );
  });

  it("UX mapping : incomplete / stale / already / timeout", () => {
    assert.equal(
      mapTierNightSeriesRpcErrorToUx("TNS_PLACEMENTS_INCOMPLETE").retry,
      true
    );
    assert.match(
      mapTierNightSeriesRpcErrorToUx("TNS_PLACEMENTS_INCOMPLETE").message,
      /n’ont pas encore terminé|pas encore terminé/
    );
    assert.equal(mapTierNightSeriesRpcErrorToUx("ALREADY_APPLIED").retry, false);
    assert.equal(mapTierNightSeriesRpcErrorToUx("TNS_STALE_RUN").terminal, true);
    assert.equal(mapTierNightSeriesRpcErrorToUx("TNS_TIMEOUT").reconciliable, true);
    assert.doesNotMatch(
      mapTierNightSeriesRpcErrorToUx("TNS_UNKNOWN").message,
      /raise exception|sql/i
    );
  });

  it("finalize déjà scoré → alreadyApplied (pas double score client)", () => {
    const runId = "run-dbl";
    const between = makeBetweenSeries(runId, 3, 0);
    const again = assertCanFinalizeTierNightSeriesRound({
      runId,
      series: between,
    });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyApplied, true);
  });

  it("series_end refuse finalize (hors already)", () => {
    const runId = "run-end";
    const end = {
      ...makeBetweenSeries(runId, 3, 2),
      phase: "series_end",
      scoredRoundIds: [`${runId}:0`, `${runId}:1`, `${runId}:2`],
      completedRoundIds: [`${runId}:0`, `${runId}:1`, `${runId}:2`],
    };
    // already scored current round → alreadyApplied first
    const withScored = assertCanFinalizeTierNightSeriesRound({ runId, series: end });
    assert.equal(withScored.alreadyApplied, true);
  });
});

describe("FEATURE-TIERNIGHT-03-D1 - tests SERIES migrés (pas d’affaiblissement)", () => {
  it("03/03a/05 gardent idempotence SQL + branchement D + pas classic croisé", () => {
    const s03 = read("tests/featureTierNightSeries03.test.js");
    assert.match(s03, /ALREADY_APPLIED|timeout/);
    assert.match(s03, /hostFinalizeTierNightSeriesRound/);
    assert.match(s03, /classic end ne croise pas finalize série/);

    const s03a = read("tests/featureTierNightSeries03a.test.js");
    assert.match(s03a, /ALREADY_APPLIED/);
    assert.match(s03a, /RPC branchée via playSession/);
    assert.match(s03a, /tiernight_series_validate_placement/);

    const s05 = read("tests/featureTierNightSeries05.test.js");
    assert.match(s05, /ALREADY_ADVANCED/);
    assert.match(s05, /advance branché via between/);
    assert.match(s05, /TNS_NO_NEXT_ROUND|series_end/);
  });

  it("legacy classic n’importe pas Series RPCs dans finalize path", () => {
    const game = read("js/games/tierNight.js");
    assert.match(game, /hasActiveTierNightSeries\(\)/);
    assert.match(game, /advanceTierNightToResultsWhenReady/);
    const classic = read("js/core/gameSync.js");
    assert.equal(classic.includes("commitTierNightSeriesRoundResult"), false);
    assert.equal(classic.includes("finalize_tiernight_series_round"), false);
  });
});
