/**
 * FEATURE-TIERNIGHT-SERIES-03 - wrapper RPC finalize_tiernight_series_round.
 *
 * Ne fait AUCUN scoring local (pas d’addScore).
 * Branchement UX : hostFinalizeTierNightSeriesRound (playSession / board série).
 * Ne pas appeler depuis classic advanceTierNightToResultsWhenReady.
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { withPatchTimeout } from "./withPatchTimeout.js";
import { SYNC_PATCH_TIMEOUT_MS } from "../config/syncConfig.js";

export const TIERNIGHT_SERIES_FINALIZE_RPC = "finalize_tiernight_series_round";

/** Codes d’erreur métier remontés par la RPC (message exception). */
export const TIERNIGHT_SERIES_FINALIZE_CODES = Object.freeze({
  AUTH_REQUIRED: "TNS_AUTH_REQUIRED",
  UNAUTHORIZED: "TNS_UNAUTHORIZED",
  SESSION_NOT_FOUND: "TNS_SESSION_NOT_FOUND",
  WRONG_GAME: "TNS_WRONG_GAME",
  NO_SERIES: "TNS_NO_SERIES",
  NO_TIERNIGHT: "TNS_NO_TIERNIGHT",
  STALE_RUN: "TNS_STALE_RUN",
  STALE_ROUND_ID: "TNS_STALE_ROUND_ID",
  STALE_ROUND_INDEX: "TNS_STALE_ROUND_INDEX",
  INVALID_PHASE: "TNS_INVALID_PHASE",
  PLACEMENTS_INCOMPLETE: "TNS_PLACEMENTS_INCOMPLETE",
  FORCE_NO_FINISHED: "TNS_FORCE_NO_FINISHED",
  SERIES_ENDED: "TNS_SERIES_ENDED",
  ALREADY_APPLIED: "ALREADY_APPLIED",
});

function requireClient() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error("Supabase non configuré.");
  }
}

/**
 * Extrait un code TNS_* / ALREADY_APPLIED depuis une erreur PostgREST.
 * @param {unknown} error
 */
export function parseTierNightSeriesFinalizeError(error) {
  const message = String(error?.message || error || "");
  const match = message.match(/\b(TNS_[A-Z0-9_]+|ALREADY_APPLIED)\b/);
  return {
    code: match ? match[1] : "TNS_UNKNOWN",
    message,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.lobbyId
 * @param {string} opts.runId
 * @param {string} opts.roundId
 * @param {number} opts.roundIndex
 * @param {string} [opts.expectedPhase="ranking"]
 * @param {boolean} [opts.force=false]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{
 *   ok: boolean,
 *   applied?: boolean,
 *   code?: string|null,
 *   phase?: string,
 *   stale?: boolean,
 *   unauthorized?: boolean,
 *   network?: boolean,
 *   timeout?: boolean,
 *   validation?: boolean,
 *   result?: object|null,
 *   error?: unknown,
 * }>}
 */
export async function commitTierNightSeriesRoundResult({
  lobbyId,
  runId,
  roundId,
  roundIndex,
  expectedPhase = "ranking",
  force = false,
  timeoutMs = SYNC_PATCH_TIMEOUT_MS,
} = {}) {
  if (!lobbyId || !runId || !roundId || !Number.isInteger(roundIndex) || roundIndex < 0) {
    return {
      ok: false,
      validation: true,
      code: "TNS_INVALID_ARGS",
      result: null,
    };
  }

  requireClient();

  const args = {
    p_lobby_id: lobbyId,
    p_run_id: String(runId),
    p_round_id: String(roundId),
    p_round_index: roundIndex,
    p_expected_phase: expectedPhase || "ranking",
    p_force: Boolean(force),
  };

  try {
    const data = await withPatchTimeout(
      (async () => {
        const { data: rpcData, error } = await supabase.rpc(
          TIERNIGHT_SERIES_FINALIZE_RPC,
          args
        );
        if (error) throw error;
        return rpcData;
      })(),
      timeoutMs
    );

    if (!data || typeof data !== "object") {
      return { ok: false, code: "TNS_EMPTY_RESPONSE", result: null };
    }

    if (data.ok === true && data.applied === false && data.code === "ALREADY_APPLIED") {
      return {
        ok: true,
        applied: false,
        code: "ALREADY_APPLIED",
        phase: data.phase ?? null,
        result: data,
      };
    }

    if (data.ok === true && data.applied === true) {
      return {
        ok: true,
        applied: true,
        code: null,
        phase: data.phase ?? null,
        result: data,
      };
    }

    return {
      ok: false,
      code: data.code || "TNS_REJECTED",
      result: data,
    };
  } catch (error) {
    const parsed = parseTierNightSeriesFinalizeError(error);
    const code = parsed.code;
    const isTimeout =
      error?.name === "TimeoutError" ||
      /timeout|trop longue/i.test(String(error?.message || ""));

    if (isTimeout) {
      return {
        ok: false,
        timeout: true,
        network: true,
        code: "TNS_TIMEOUT",
        error,
        result: null,
      };
    }

    const stale =
      code === "TNS_STALE_RUN" ||
      code === "TNS_STALE_ROUND_ID" ||
      code === "TNS_STALE_ROUND_INDEX" ||
      code === "TNS_TOPIC_MISMATCH" ||
      code === "TNS_INVALID_PHASE" ||
      code === "TNS_SERIES_ENDED";

    return {
      ok: false,
      code,
      stale,
      unauthorized: code === "TNS_UNAUTHORIZED" || code === "TNS_AUTH_REQUIRED",
      validation:
        code === "TNS_NO_SERIES" ||
        code === "TNS_PLACEMENTS_INCOMPLETE" ||
        code === "TNS_FORCE_NO_FINISHED" ||
        code === "TNS_INVALID_SERIES" ||
        code === "TNS_UNSUPPORTED_VERSION",
      network: !stale && code === "TNS_UNKNOWN",
      error,
      result: null,
    };
  }
}

/**
 * Mapping des arguments RPC (testable sans réseau).
 */
export function buildFinalizeTierNightSeriesRoundRpcArgs({
  lobbyId,
  runId,
  roundId,
  roundIndex,
  expectedPhase = "ranking",
  force = false,
} = {}) {
  return {
    p_lobby_id: lobbyId,
    p_run_id: String(runId ?? ""),
    p_round_id: String(roundId ?? ""),
    p_round_index: roundIndex,
    p_expected_phase: expectedPhase || "ranking",
    p_force: Boolean(force),
  };
}
