/**
 * FEATURE-TIERNIGHT-03-D — finalize, intermanches, advance, series_end.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTierNightSeriesRoundId,
  validateTierNightSeries,
  computeNextTierNightRoundState,
  isTierNightSeriesLastRound,
  createTierNightSeriesState,
  buildTierNightSeriesQueue,
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
} from "../js/core/tierNightSeries.js";
import { TIER_NIGHT_ROSTER_TOPICS } from "../data/tierTopics.js";
import { isTierNightSeriesUiEnabled } from "../js/core/tierNightSeriesGate.js";
import { shouldPreferTierNightEndRoute } from "../js/core/tierNightConfig.js";

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
  assertCanFinalizeTierNightSeriesRound,
  assertCanAdvanceTierNightSeriesRound,
  TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY,
  hasActiveTierNightSeries,
} = await import("../js/core/tierNightSeriesPlaySession.js");

function makeBetweenSeries(runId, roundCount, roundIndex) {
  const built = buildTierNightSeriesQueue({
    runId,
    topics: TIER_NIGHT_ROSTER_TOPICS,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    rng: () => 0,
  });
  assert.equal(built.ok, true);
  const created = createTierNightSeriesState({
    runId,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    queue: built.queue,
  });
  const scored = [];
  for (let i = 0; i <= roundIndex; i += 1) scored.push(`${runId}:${i}`);
  return {
    ...created.series,
    phase: "between_rounds",
    roundIndex,
    scoredRoundIds: scored,
    completedRoundIds: [...scored],
    roundHistory: scored.map((id, i) => ({
      roundId: id,
      roundIndex: i,
      topicId: built.queue[i].topicId,
      topicSnapshot: built.queue[i].topicSnapshot,
    })),
    roundRecap: {
      roundId: `${runId}:${roundIndex}`,
      roundIndex,
      topicSnapshot: built.queue[roundIndex].topicSnapshot,
    },
  };
}

describe("FEATURE-TIERNIGHT-03-D - mapping phases / écrans", () => {
  it("phases → écrans (canonique sans round_result)", () => {
    assert.equal(resolveTierNightSeriesScreenFromPhase("ranking"), "tiernight");
    assert.equal(resolveTierNightSeriesScreenFromPhase("between_rounds"), "tiernight-between");
    assert.equal(resolveTierNightSeriesScreenFromPhase("series_end"), "tiernight-end");
    assert.equal(resolveTierNightSeriesScreenFromPhase("round_result"), null);
  });

  it("écran between enregistré + CTA hôte", () => {
    const main = read("js/main.js");
    assert.match(main, /registerScreen\("tiernight-between"/);
    assert.match(main, /mountTierNightBetween/);
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /▶ Thème suivant/);
    assert.match(between, /En attente de l’hôte/);
    assert.doesNotMatch(between, /Créer un thème|Créer mon thème/);
  });

  it("gate production toujours OFF", () => {
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});

describe("FEATURE-TIERNIGHT-03-D - validate conserve history/recap", () => {
  it("roundHistory + roundRecap préservés après validate", () => {
    const runId = "run-hist";
    const series = makeBetweenSeries(runId, 3, 0);
    const res = validateTierNightSeries(series, { runId });
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.series.roundHistory));
    assert.equal(res.series.roundHistory.length, 1);
    assert.equal(res.series.roundRecap.roundId, `${runId}:0`);
  });
});

describe("FEATURE-TIERNIGHT-03-D - finalize guards", () => {
  it("ranking OK ; déjà scoré → alreadyApplied", () => {
    const runId = "run-f";
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
    const ok = assertCanFinalizeTierNightSeriesRound({
      runId,
      series: created.series,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.roundId, `${runId}:0`);

    const scored = {
      ...created.series,
      scoredRoundIds: [`${runId}:0`],
      completedRoundIds: [`${runId}:0`],
      phase: "between_rounds",
    };
    const again = assertCanFinalizeTierNightSeriesRound({ runId, series: scored });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyApplied, true);
  });

  it("board branche finalize série ; classic séparé", () => {
    const game = read("js/games/tierNight.js");
    assert.match(game, /hostFinalizeTierNightSeriesRound/);
    assert.match(game, /hasActiveTierNightSeries/);
    assert.match(game, /advanceTierNightToResultsWhenReady/);
  });

  it("playSession : verrou + reconcile timeout ; wrapper finalize sans addScore", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(play, /createActionLock/);
    assert.match(play, /reconcileSeriesFromServer/);
    assert.match(play, /commitTierNightSeriesRoundResult/);
    const fin = read("js/core/tierNightSeriesFinalize.js");
    assert.equal(/\bimport\b[\s\S]*\baddScore\b/.test(fin), false);
    assert.equal(fin.includes("applyTierNightRoundScores"), false);
  });
});

describe("FEATURE-TIERNIGHT-03-D - advance + dernière manche", () => {
  it("matrice clear/preserve documentée", () => {
    assert.ok(TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY.clear.includes("placements"));
    assert.ok(TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY.preserve.includes("series.queue"));
    assert.ok(
      TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY.preserve.includes("consumedCustomRosterTopicIds")
    );
  });

  it("advance +1 depuis queue ; dernière manche refuse advance", () => {
    for (const roundCount of [3, 5, 8]) {
      const runId = `run-${roundCount}`;
      const between = makeBetweenSeries(runId, roundCount, 0);
      const next = computeNextTierNightRoundState({ runId, series: between });
      assert.equal(next.ok, true, String(roundCount));
      assert.equal(next.series.roundIndex, 1);
      assert.equal(next.series.phase, "ranking");
      assert.equal(next.clearPlacements, true);

      const lastIdx = roundCount - 1;
      const lastBetween = makeBetweenSeries(runId, roundCount, lastIdx);
      assert.equal(isTierNightSeriesLastRound(lastBetween), true);
      const refuse = assertCanAdvanceTierNightSeriesRound({
        runId,
        series: lastBetween,
      });
      assert.equal(refuse.ok, false);
      assert.equal(refuse.noNextRound, true);
    }
  });

  it("legacy count 7 : dernière index 6 lisible", () => {
    const runId = "run-leg7";
    const q = TIER_NIGHT_ROSTER_TOPICS.slice(0, 7).map((t, i) => ({
      roundId: `${runId}:${i}`,
      roundIndex: i,
      topicId: `roster:${t.id}`,
      topicSnapshot: {
        id: t.id,
        name: t.name,
        emoji: t.emoji || "x",
        categoryId: t.categoryId || "survival",
        custom: false,
      },
    }));
    const series = {
      version: 1,
      categoryIds: ["*"],
      roundCount: 7,
      queue: q,
      roundIndex: 6,
      phase: "between_rounds",
      scoredRoundIds: q.map((e) => e.roundId),
      completedRoundIds: q.map((e) => e.roundId),
    };
    const validated = validateTierNightSeries(series, { runId });
    assert.equal(validated.ok, true, validated.code);
    assert.equal(isTierNightSeriesLastRound(validated.series), true);
    const refuse = assertCanAdvanceTierNightSeriesRound({
      runId,
      series: validated.series,
    });
    assert.equal(refuse.ok, false);
  });

  it("indices finaux 2/4/7 pour 3/5/8", () => {
    assert.equal(buildTierNightSeriesRoundId("r", 2), "r:2");
    assert.equal(buildTierNightSeriesRoundId("r", 4), "r:4");
    assert.equal(buildTierNightSeriesRoundId("r", 7), "r:7");
  });
});

describe("FEATURE-TIERNIGHT-03-D - screen resolution", () => {
  it("gameSync phase between/end prioritaire", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /tiernight-between/);
    assert.match(sync, /phase === "series_end"/);
    assert.match(sync, /canRouteToTierNightEnd/);
  });

  it("series_end préfère end route", () => {
    assert.equal(
      shouldPreferTierNightEndRoute({
        state: { tierNight: { series: { phase: "series_end" }, lobbyStarted: false } },
        declared: "tiernight",
      }),
      true
    );
    assert.equal(
      shouldPreferTierNightEndRoute({
        state: {
          tierNight: {
            lobbyStarted: true,
            series: { phase: "ranking" },
          },
        },
        declared: "tiernight-end",
      }),
      false
    );
  });
});

describe("FEATURE-TIERNIGHT-03-D - legacy croisé", () => {
  it("sans series → hasActiveTierNightSeries false", () => {
    assert.equal(hasActiveTierNightSeries({ lobbyStarted: true, items: ["A"] }), false);
  });

  it("classic path conserve advanceTierNightToResultsWhenReady", () => {
    const game = read("js/games/tierNight.js");
    assert.match(game, /advanceTierNightToResultsWhenReady/);
    assert.match(game, /if \(hasActiveTierNightSeries/);
  });

  it("end : pas de CTA Thème suivant ; historique série", () => {
    const end = read("js/screens/tierNightEnd.js");
    assert.doesNotMatch(end, /Thème suivant/);
    assert.match(end, /Fin de série|Classement de la série/);
    assert.match(end, /Changer de mode/);
  });
});

describe("FEATURE-TIERNIGHT-03-D - SQL preuves (pas de nouvelle migration)", () => {
  it("finalize 03a : last → series_end ; sinon between ; tierNightsPlayed une fois", () => {
    const sql = read("supabase/feature-tiernight-series-03a-finalize-round-hardening.sql");
    assert.match(sql, /v_next_phase := case when v_is_last then 'series_end' else 'between_rounds'/);
    assert.match(sql, /tierNightsPlayed/);
    assert.match(sql, /ALREADY_APPLIED/);
    // Counts 8 : validateur A1-bis (pas 03a seul — 03a historique = 3/5/7)
    const a1bis = read("supabase/feature-tiernight-03-a1bis-series-shape-strict.sql");
    assert.match(a1bis, /3,\s*5,\s*7,\s*8|array\[3,\s*5,\s*7,\s*8\]/);
  });

  it("advance 05 : between → ranking ; refuse series_end", () => {
    const sql = read("supabase/feature-tiernight-series-05-advance-round.sql");
    assert.match(sql, /advance_tiernight_series_round/);
    assert.match(sql, /between_rounds/);
    assert.match(sql, /ALREADY_ADVANCED/);
    assert.match(sql, /TNS_NO_NEXT_ROUND|TNS_SERIES_ENDED/);
  });
});
