/**
 * FEATURE-TIERNIGHT-SERIES-05 — wrapper advance + contrats SQL / non-branchement.
 */
import { describe, it, mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  computeNextTierNightRoundState,
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
} from "../js/core/tierNightSeries.js";
import { TIER_NIGHT_ROSTER_TOPICS } from "../data/tierTopics.js";
import { isTierNightSeriesUiEnabled } from "../js/core/tierNightSeriesGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

let rpcImpl = async () => ({ data: null, error: null });

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: {
      rpc: (...args) => rpcImpl(...args),
    },
  },
});

const {
  commitTierNightSeriesNextRound,
  buildAdvanceTierNightSeriesRoundRpcArgs,
  parseTierNightSeriesAdvanceError,
  TIERNIGHT_SERIES_ADVANCE_RPC,
} = await import("../js/core/tierNightSeriesAdvance.js");

describe("FEATURE-TIERNIGHT-SERIES-05 - args / parse", () => {
  it("buildAdvanceTierNightSeriesRoundRpcArgs mappe uniquement les ids", () => {
    const args = buildAdvanceTierNightSeriesRoundRpcArgs({
      lobbyId: "lobby-1",
      runId: "run-a",
      currentRoundId: "run-a:0",
      currentRoundIndex: 0,
      expectedPhase: "between_rounds",
    });
    assert.deepEqual(args, {
      p_lobby_id: "lobby-1",
      p_run_id: "run-a",
      p_current_round_id: "run-a:0",
      p_current_round_index: 0,
      p_expected_phase: "between_rounds",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(args, "p_queue"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(args, "p_topic_id"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(args, "p_tier_night"), false);
  });

  it("parseTierNightSeriesAdvanceError extrait TNS_* / ALREADY_ADVANCED", () => {
    assert.equal(
      parseTierNightSeriesAdvanceError({ message: "TNS_NO_NEXT_ROUND" }).code,
      "TNS_NO_NEXT_ROUND"
    );
    assert.equal(
      parseTierNightSeriesAdvanceError({ message: "x ALREADY_ADVANCED y" }).code,
      "ALREADY_ADVANCED"
    );
  });
});

describe("FEATURE-TIERNIGHT-SERIES-05 - commitTierNightSeriesNextRound", () => {
  before(() => {
    rpcImpl = async () => ({ data: null, error: null });
  });

  it("refuse args invalides sans appeler RPC", async () => {
    let called = false;
    rpcImpl = async () => {
      called = true;
      return { data: null, error: null };
    };
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "",
      runId: "r",
      currentRoundId: "r:0",
      currentRoundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.validation, true);
    assert.equal(called, false);
  });

  it("succès applied:true", async () => {
    rpcImpl = async (name, args) => {
      assert.equal(name, TIERNIGHT_SERIES_ADVANCE_RPC);
      assert.equal(args.p_current_round_index, 0);
      assert.equal(args.p_expected_phase, "between_rounds");
      return {
        data: {
          ok: true,
          applied: true,
          phase: "ranking",
          roundId: "run:1",
          roundIndex: 1,
        },
        error: null,
      };
    };
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "L1",
      runId: "run",
      currentRoundId: "run:0",
      currentRoundIndex: 0,
    });
    assert.equal(res.ok, true);
    assert.equal(res.applied, true);
    assert.equal(res.phase, "ranking");
    assert.equal(res.roundIndex, 1);
  });

  it("succès idempotent ALREADY_ADVANCED", async () => {
    rpcImpl = async () => ({
      data: {
        ok: true,
        applied: false,
        code: "ALREADY_ADVANCED",
        phase: "ranking",
        roundIndex: 1,
      },
      error: null,
    });
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "L1",
      runId: "run",
      currentRoundId: "run:0",
      currentRoundIndex: 0,
    });
    assert.equal(res.ok, true);
    assert.equal(res.applied, false);
    assert.equal(res.code, "ALREADY_ADVANCED");
  });

  it("stale index", async () => {
    rpcImpl = async () => ({
      data: null,
      error: { message: "TNS_STALE_ROUND_INDEX" },
    });
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "L1",
      runId: "run",
      currentRoundId: "run:0",
      currentRoundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.stale, true);
    assert.equal(res.code, "TNS_STALE_ROUND_INDEX");
  });

  it("unauthorized", async () => {
    rpcImpl = async () => ({
      data: null,
      error: { message: "TNS_UNAUTHORIZED" },
    });
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "L1",
      runId: "run",
      currentRoundId: "run:0",
      currentRoundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.unauthorized, true);
  });

  it("no next round", async () => {
    rpcImpl = async () => ({
      data: null,
      error: { message: "TNS_NO_NEXT_ROUND" },
    });
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "L1",
      runId: "run",
      currentRoundId: "run:2",
      currentRoundIndex: 2,
    });
    assert.equal(res.ok, false);
    assert.equal(res.noNextRound, true);
  });

  it("timeout → flag timeout, pas de mutation locale", async () => {
    rpcImpl = async () =>
      new Promise(() => {
        /* hang */
      });
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "L1",
      runId: "run",
      currentRoundId: "run:0",
      currentRoundIndex: 0,
      timeoutMs: 20,
    });
    assert.equal(res.ok, false);
    assert.equal(res.timeout, true);
    assert.equal(res.code, "TNS_TIMEOUT");
  });

  it("screen mismatch → stale, pas ALREADY_ADVANCED", async () => {
    rpcImpl = async () => ({
      data: null,
      error: { message: "TNS_SCREEN_MISMATCH" },
    });
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "L1",
      runId: "run",
      currentRoundId: "run:0",
      currentRoundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.stale, true);
    assert.equal(res.code, "TNS_SCREEN_MISMATCH");
  });

  it("completed manquant → validation", async () => {
    rpcImpl = async () => ({
      data: null,
      error: { message: "TNS_ROUND_NOT_COMPLETED" },
    });
    const res = await commitTierNightSeriesNextRound({
      lobbyId: "L1",
      runId: "run",
      currentRoundId: "run:0",
      currentRoundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.validation, true);
    assert.equal(res.code, "TNS_ROUND_NOT_COMPLETED");
  });

  it("wrapper n’importe pas state / ne mute pas placements", () => {
    const src = read("js/core/tierNightSeriesAdvance.js");
    assert.equal(src.includes('from "./state.js"'), false);
    assert.equal(src.includes("saveStatePatch"), false);
    assert.equal(src.includes("addScore"), false);
    assert.equal(src.includes("patchGameState"), false);
    assert.match(src, /Ne mute aucun state local/);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-05 - oracle pure + SQL contrat", () => {
  it("computeNextTierNightRoundState aligne index/topic/clears", () => {
    const runId = "run-s5";
    const built = buildTierNightSeriesQueue({
      runId,
      topics: TIER_NIGHT_ROSTER_TOPICS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0,
    });
    assert.equal(built.ok, true);
    const created = createTierNightSeriesState({
      runId,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      queue: built.queue,
    });
    const between = {
      ...created.series,
      phase: "between_rounds",
      roundIndex: 0,
      scoredRoundIds: [`${runId}:0`],
      completedRoundIds: [`${runId}:0`],
    };
    const next = computeNextTierNightRoundState({ runId, series: between });
    assert.equal(next.ok, true);
    assert.equal(next.series.roundIndex, 1);
    assert.equal(next.series.phase, "ranking");
    assert.equal(next.topicId, built.queue[1].topicId);
    assert.equal(next.clearPlacements, true);
    assert.equal(next.clearFinished, true);
    assert.equal(next.clearRoundRecap, true);
    assert.deepEqual(next.series.queue, built.queue);
  });

  it("refuse dernière manche (oracle)", () => {
    const runId = "run-s5-last";
    const built = buildTierNightSeriesQueue({
      runId,
      topics: TIER_NIGHT_ROSTER_TOPICS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      rng: () => 0.1,
    });
    const created = createTierNightSeriesState({
      runId,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      queue: built.queue,
    });
    const between = {
      ...created.series,
      phase: "between_rounds",
      roundIndex: 2,
    };
    const next = computeNextTierNightRoundState({ runId, series: between });
    assert.equal(next.ok, false);
    assert.equal(next.code, "LAST_ROUND");
  });

  it("SQL : FOR UPDATE, AH, ALREADY_ADVANCED, no score mutation, screen", () => {
    const sql = read("supabase/feature-tiernight-series-05-advance-round.sql");
    assert.match(sql, /advance_tiernight_series_round/);
    assert.match(sql, /for update/i);
    assert.match(sql, /is_acting_host/);
    assert.match(sql, /is_lobby_host/);
    assert.match(sql, /ALREADY_ADVANCED/);
    assert.match(sql, /TNS_NO_NEXT_ROUND/);
    assert.match(sql, /TNS_ROUND_NOT_SCORED/);
    assert.match(sql, /TNS_ROUND_NOT_COMPLETED/);
    assert.match(sql, /TNS_HISTORY_MISSING_ROUND/);
    assert.match(sql, /TNS_ROUND_RECAP_MISMATCH/);
    assert.match(sql, /tiernight_series_validate_series_shape/);
    assert.match(sql, /security definer/i);
    assert.match(sql, /search_path = pg_catalog, public/);
    assert.match(sql, /revoke all[\s\S]*from anon/i);
    assert.match(sql, /grant execute[\s\S]*to authenticated/i);
    assert.match(sql, /screen = 'tiernight'/);
    assert.match(sql, /'roundRecap', null/);
    assert.match(sql, /'placements', '\{\}'::jsonb/);
    assert.match(sql, /'finished', '\{\}'::jsonb/);
    // Pas de scoring
    assert.doesNotMatch(sql, /tiernight_series_compute_scores/);
    assert.doesNotMatch(sql, /tierNightsPlayed/);
    assert.doesNotMatch(sql, /addScore/);
    // Immutabilité explicitement gardée
    assert.match(sql, /TNS_QUEUE_MUTATED/);
    assert.match(sql, /TNS_LEDGER_MUTATED/);
    assert.match(sql, /TNS_HISTORY_MUTATED/);
  });

  it("SQL 05A : preuve ALREADY_ADVANCED complète (completed+history+screen)", () => {
    const sql = read("supabase/feature-tiernight-series-05-advance-round.sql");
    const idempo = sql.match(
      /Idempotence[\s\S]*?Première application/
    );
    assert.ok(idempo, "bloc idempotence introuvable");
    const block = idempo[0];
    // Entrée candidate ranking N+1
    assert.match(block, /v_phase = 'ranking'/);
    assert.match(block, /v_round_index = v_next_index/);
    // Preuves renforcées
    assert.match(block, /TNS_MISSING_NEXT_ROUND/);
    assert.match(block, /TNS_NEXT_ROUND_ID_MISMATCH/);
    assert.match(block, /TNS_TOPIC_MISMATCH/);
    assert.match(block, /TNS_SCREEN_MISMATCH/);
    assert.match(block, /is distinct from 'tiernight'/);
    assert.match(block, /TNS_ROUND_NOT_SCORED/);
    assert.match(block, /TNS_ROUND_NOT_COMPLETED/);
    assert.match(block, /TNS_HISTORY_MISSING_ROUND/);
    assert.match(block, /TNS_HISTORY_AMBIGUOUS_ROUND/);
    // completed exigé dans la branche (pas seulement scored)
    assert.match(block, /jsonb_array_elements_text\(v_completed\)/);
    // roundRecap NON exigé pour ALREADY_ADVANCED
    assert.doesNotMatch(block, /TNS_ROUND_RECAP/);
    // Preuve incomplète → raise, pas return conditionnel faible
    assert.match(block, /raise exception 'TNS_ROUND_NOT_COMPLETED'/);
    assert.match(block, /raise exception 'TNS_HISTORY_MISSING_ROUND'/);
    assert.match(block, /raise exception 'TNS_SCREEN_MISMATCH'/);
  });

  it("SQL checklist couvre stale idempotence 29a–29f", () => {
    const smoke = read("supabase/feature-tiernight-series-05-smoke-runbook.sql");
    assert.match(smoke, /32\. ancien round stale/);
    assert.match(smoke, /17\. avance valide/);
    assert.match(smoke, /29\. retry identique/);
    assert.match(smoke, /29a\. ranking N\+1 sans completed/);
    assert.match(smoke, /29b\. ranking N\+1 sans history/);
    assert.match(smoke, /29c\. ranking N\+1 history/);
    assert.match(smoke, /29d\. ranking N\+1 screen between/);
    assert.match(smoke, /29e\. ranking N\+1 topic faux/);
    assert.match(smoke, /29f\. appel from N, serveur N\+2/);
    assert.match(smoke, /26\. scores inchangés/);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-05 - branchement D + gate", () => {
  it("advance branché via between/playSession ; pas select/launch/finalize wrapper", () => {
    const between = read("js/screens/tierNightBetween.js");
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(between, /hostAdvanceTierNightSeriesRound/);
    assert.match(play, /commitTierNightSeriesNextRound/);
    for (const rel of [
      "js/screens/tierNightSelect.js",
      "js/core/tierNightLiveSession.js",
      "js/core/tierNightSeriesLaunch.js",
      "js/core/tierNightSeriesFinalize.js",
    ]) {
      const src = read(rel);
      assert.equal(src.includes("commitTierNightSeriesNextRound"), false, rel);
      assert.equal(src.includes("advance_tiernight_series_round"), false, rel);
    }
  });

  it("finalize branché via playSession/board (SERIES-03/D)", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    const game = read("js/games/tierNight.js");
    assert.match(play, /commitTierNightSeriesRoundResult/);
    assert.match(game, /hostFinalizeTierNightSeriesRound/);
  });

  it("gate série reste OFF par défaut", () => {
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });

  it("pas de fire-and-forget void rpc dans le wrapper", () => {
    const src = read("js/core/tierNightSeriesAdvance.js");
    assert.doesNotMatch(src, /void\s+supabase\.rpc/);
    assert.doesNotMatch(src, /void\s+commitTierNightSeriesNextRound/);
    assert.match(src, /withPatchTimeout/);
  });
});
