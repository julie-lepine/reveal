/**
 * FEATURE-TIERNIGHT-SERIES-03 — wrapper finalize + contrats SQL / non-branchement.
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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
  commitTierNightSeriesRoundResult,
  buildFinalizeTierNightSeriesRoundRpcArgs,
  parseTierNightSeriesFinalizeError,
  TIERNIGHT_SERIES_FINALIZE_RPC,
} = await import("../js/core/tierNightSeriesFinalize.js");

describe("FEATURE-TIERNIGHT-SERIES-03 - args / parse", () => {
  it("buildFinalizeTierNightSeriesRoundRpcArgs mappe les params RPC", () => {
    assert.deepEqual(
      buildFinalizeTierNightSeriesRoundRpcArgs({
        lobbyId: "lobby-1",
        runId: "run-a",
        roundId: "run-a:0",
        roundIndex: 0,
        expectedPhase: "ranking",
        force: true,
      }),
      {
        p_lobby_id: "lobby-1",
        p_run_id: "run-a",
        p_round_id: "run-a:0",
        p_round_index: 0,
        p_expected_phase: "ranking",
        p_force: true,
      }
    );
  });

  it("parseTierNightSeriesFinalizeError extrait les codes TNS_*", () => {
    assert.equal(
      parseTierNightSeriesFinalizeError({ message: "TNS_STALE_RUN" }).code,
      "TNS_STALE_RUN"
    );
    assert.equal(
      parseTierNightSeriesFinalizeError({ message: "boom TNS_UNAUTHORIZED detail" }).code,
      "TNS_UNAUTHORIZED"
    );
  });
});

describe("FEATURE-TIERNIGHT-SERIES-03 - commitTierNightSeriesRoundResult", () => {
  before(() => {
    rpcImpl = async () => ({ data: null, error: null });
  });

  it("refuse args invalides sans appeler RPC", async () => {
    let called = false;
    rpcImpl = async () => {
      called = true;
      return { data: null, error: null };
    };
    const res = await commitTierNightSeriesRoundResult({
      lobbyId: "",
      runId: "r",
      roundId: "r:0",
      roundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.validation, true);
    assert.equal(called, false);
  });

  it("succès applied:true", async () => {
    rpcImpl = async (name, args) => {
      assert.equal(name, TIERNIGHT_SERIES_FINALIZE_RPC);
      assert.equal(args.p_lobby_id, "L1");
      assert.equal(args.p_round_index, 1);
      return {
        data: {
          ok: true,
          applied: true,
          phase: "between_rounds",
          roundId: "run:1",
        },
        error: null,
      };
    };
    const res = await commitTierNightSeriesRoundResult({
      lobbyId: "L1",
      runId: "run",
      roundId: "run:1",
      roundIndex: 1,
    });
    assert.equal(res.ok, true);
    assert.equal(res.applied, true);
    assert.equal(res.phase, "between_rounds");
  });

  it("succès idempotent ALREADY_APPLIED", async () => {
    rpcImpl = async () => ({
      data: {
        ok: true,
        applied: false,
        code: "ALREADY_APPLIED",
        phase: "between_rounds",
      },
      error: null,
    });
    const res = await commitTierNightSeriesRoundResult({
      lobbyId: "L1",
      runId: "run",
      roundId: "run:0",
      roundIndex: 0,
    });
    assert.equal(res.ok, true);
    assert.equal(res.applied, false);
    assert.equal(res.code, "ALREADY_APPLIED");
  });

  it("stale run", async () => {
    rpcImpl = async () => ({
      data: null,
      error: { message: "TNS_STALE_RUN" },
    });
    const res = await commitTierNightSeriesRoundResult({
      lobbyId: "L1",
      runId: "run",
      roundId: "run:0",
      roundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.stale, true);
    assert.equal(res.code, "TNS_STALE_RUN");
  });

  it("unauthorized", async () => {
    rpcImpl = async () => ({
      data: null,
      error: { message: "TNS_UNAUTHORIZED" },
    });
    const res = await commitTierNightSeriesRoundResult({
      lobbyId: "L1",
      runId: "run",
      roundId: "run:0",
      roundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.unauthorized, true);
  });

  it("validation NO_SERIES", async () => {
    rpcImpl = async () => ({
      data: null,
      error: { message: "TNS_NO_SERIES" },
    });
    const res = await commitTierNightSeriesRoundResult({
      lobbyId: "L1",
      runId: "run",
      roundId: "run:0",
      roundIndex: 0,
    });
    assert.equal(res.ok, false);
    assert.equal(res.validation, true);
    assert.equal(res.code, "TNS_NO_SERIES");
  });

  it("timeout → flag timeout, pas de mutation locale", async () => {
    rpcImpl = async () =>
      new Promise(() => {
        /* hang */
      });
    const res = await commitTierNightSeriesRoundResult({
      lobbyId: "L1",
      runId: "run",
      roundId: "run:0",
      roundIndex: 0,
      timeoutMs: 20,
    });
    assert.equal(res.ok, false);
    assert.equal(res.timeout, true);
    assert.equal(res.code, "TNS_TIMEOUT");
  });
});

describe("FEATURE-TIERNIGHT-SERIES-03 - branchement D + SQL contrat", () => {
  it("finalize branché sur board série ; pas sur select", () => {
    const game = readFileSync(join(ROOT, "js/games/tierNight.js"), "utf8");
    const play = readFileSync(join(ROOT, "js/core/tierNightSeriesPlaySession.js"), "utf8");
    const select = readFileSync(join(ROOT, "js/screens/tierNightSelect.js"), "utf8");
    assert.match(game, /hostFinalizeTierNightSeriesRound/);
    assert.match(game, /hasActiveTierNightSeries/);
    assert.match(play, /commitTierNightSeriesRoundResult/);
    assert.equal(select.includes("commitTierNightSeriesRoundResult"), false);
    assert.equal(select.includes("finalize_tiernight_series_round"), false);
  });

  it("classic end ne croise pas finalize série", () => {
    const game = readFileSync(join(ROOT, "js/games/tierNight.js"), "utf8");
    assert.match(game, /advanceTierNightToResultsWhenReady/);
    assert.match(game, /hasActiveTierNightSeries\(\)/);
  });

  it("wrapper n’appelle pas addScore / applyTierNightRoundScores", () => {
    const src = readFileSync(
      join(ROOT, "js/core/tierNightSeriesFinalize.js"),
      "utf8"
    );
    assert.equal(/\bimport\b[\s\S]*\baddScore\b/.test(src), false);
    assert.equal(src.includes("applyTierNightRoundScores"), false);
    assert.equal(src.includes('from "./state.js"'), false);
    assert.match(src, /AUCUN scoring local/);
  });

  it("SQL : FOR UPDATE, ledger, phases, acting host, idempotence", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/feature-tiernight-series-03-finalize-round.sql"),
      "utf8"
    );
    assert.match(sql, /finalize_tiernight_series_round/);
    assert.match(sql, /for update/i);
    assert.match(sql, /scoredRoundIds/);
    assert.match(sql, /between_rounds/);
    assert.match(sql, /series_end/);
    assert.match(sql, /ALREADY_APPLIED/);
    assert.match(sql, /is_acting_host/);
    assert.match(sql, /is_lobby_host/);
    assert.match(sql, /TNS_NO_SERIES/);
    assert.match(sql, /tierNightsPlayed/);
    assert.match(sql, /security definer/i);
    assert.match(sql, /search_path = pg_catalog, public/);
    assert.match(sql, /grant execute/i);
  });
});
