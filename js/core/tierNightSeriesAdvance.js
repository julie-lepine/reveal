/**
 * FEATURE-TIERNIGHT-SERIES-05 — wrapper RPC advance_tiernight_series_round.
 *
 * Transition between_rounds → ranking. Aucun scoring.
 * Branchement UX : hostAdvanceTierNightSeriesRound (tiernight-between).
 * expectedPhase SQL = between_rounds uniquement (pas round_result).
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { withPatchTimeout } from "./withPatchTimeout.js";
import { SYNC_PATCH_TIMEOUT_MS } from "../config/syncConfig.js";

export const TIERNIGHT_SERIES_ADVANCE_RPC = "advance_tiernight_series_round";

/** Codes métier remontés par la RPC / wrapper. */
export const TIERNIGHT_SERIES_ADVANCE_CODES = Object.freeze({
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
  SERIES_ENDED: "TNS_SERIES_ENDED",
  NO_NEXT_ROUND: "TNS_NO_NEXT_ROUND",
  SCREEN_MISMATCH: "TNS_SCREEN_MISMATCH",
  ROUND_NOT_SCORED: "TNS_ROUND_NOT_SCORED",
  ROUND_NOT_COMPLETED: "TNS_ROUND_NOT_COMPLETED",
  HISTORY_MISSING_ROUND: "TNS_HISTORY_MISSING_ROUND",
  HISTORY_AMBIGUOUS_ROUND: "TNS_HISTORY_AMBIGUOUS_ROUND",
  ROUND_RECAP_MISMATCH: "TNS_ROUND_RECAP_MISMATCH",
  ALREADY_ADVANCED: "ALREADY_ADVANCED",
});

function requireClient() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error("Supabase non configuré.");
  }
}

/**
 * Extrait un code TNS_* / ALREADY_ADVANCED depuis une erreur PostgREST.
 * @param {unknown} error
 */
export function parseTierNightSeriesAdvanceError(error) {
  const message = String(error?.message || error || "");
  const match = message.match(/\b(TNS_[A-Z0-9_]+|ALREADY_ADVANCED)\b/);
  return {
    code: match ? match[1] : "TNS_UNKNOWN",
    message,
  };
}

/**
 * Mapping des arguments RPC (testable sans réseau).
 */
export function buildAdvanceTierNightSeriesRoundRpcArgs({
  lobbyId,
  runId,
  currentRoundId,
  currentRoundIndex,
  expectedPhase = "between_rounds",
} = {}) {
  return {
    p_lobby_id: lobbyId,
    p_run_id: String(runId ?? ""),
    p_current_round_id: String(currentRoundId ?? ""),
    p_current_round_index: currentRoundIndex,
    p_expected_phase: expectedPhase || "between_rounds",
  };
}

/**
 * Appelle la RPC d’avance. Ne mute aucun state local.
 *
 * @param {object} opts
 * @param {string} opts.lobbyId
 * @param {string} opts.runId
 * @param {string} opts.currentRoundId — roundId de la manche between_rounds courante
 * @param {number} opts.currentRoundIndex
 * @param {string} [opts.expectedPhase="between_rounds"]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{
 *   ok: boolean,
 *   applied?: boolean,
 *   code?: string|null,
 *   phase?: string,
 *   roundIndex?: number,
 *   stale?: boolean,
 *   unauthorized?: boolean,
 *   noNextRound?: boolean,
 *   network?: boolean,
 *   timeout?: boolean,
 *   validation?: boolean,
 *   result?: object|null,
 *   error?: unknown,
 * }>}
 */
export async function commitTierNightSeriesNextRound({
  lobbyId,
  runId,
  currentRoundId,
  currentRoundIndex,
  expectedPhase = "between_rounds",
  timeoutMs = SYNC_PATCH_TIMEOUT_MS,
} = {}) {
  if (
    !lobbyId ||
    !runId ||
    !currentRoundId ||
    !Number.isInteger(currentRoundIndex) ||
    currentRoundIndex < 0
  ) {
    return {
      ok: false,
      validation: true,
      code: "TNS_INVALID_ARGS",
      result: null,
    };
  }

  requireClient();

  const args = buildAdvanceTierNightSeriesRoundRpcArgs({
    lobbyId,
    runId,
    currentRoundId,
    currentRoundIndex,
    expectedPhase,
  });

  try {
    const data = await withPatchTimeout(
      (async () => {
        const { data: rpcData, error } = await supabase.rpc(
          TIERNIGHT_SERIES_ADVANCE_RPC,
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

    if (data.ok === true && data.applied === false && data.code === "ALREADY_ADVANCED") {
      return {
        ok: true,
        applied: false,
        code: "ALREADY_ADVANCED",
        phase: data.phase ?? null,
        roundIndex: data.roundIndex ?? null,
        result: data,
      };
    }

    if (data.ok === true && data.applied === true) {
      return {
        ok: true,
        applied: true,
        code: null,
        phase: data.phase ?? null,
        roundIndex: data.roundIndex ?? null,
        result: data,
      };
    }

    return {
      ok: false,
      code: data.code || "TNS_REJECTED",
      result: data,
    };
  } catch (error) {
    const parsed = parseTierNightSeriesAdvanceError(error);
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
      code === "TNS_SERIES_ENDED" ||
      code === "TNS_ROUND_ID_MISMATCH" ||
      code === "TNS_SCREEN_MISMATCH";

    return {
      ok: false,
      code,
      stale,
      unauthorized: code === "TNS_UNAUTHORIZED" || code === "TNS_AUTH_REQUIRED",
      noNextRound: code === "TNS_NO_NEXT_ROUND" || code === "TNS_MISSING_NEXT_ROUND",
      validation:
        code === "TNS_NO_SERIES" ||
        code === "TNS_NO_TIERNIGHT" ||
        code === "TNS_INVALID_SERIES" ||
        code === "TNS_UNSUPPORTED_VERSION" ||
        code === "TNS_ROUND_NOT_SCORED" ||
        code === "TNS_ROUND_NOT_COMPLETED" ||
        code === "TNS_HISTORY_MISSING_ROUND" ||
        code === "TNS_HISTORY_AMBIGUOUS_ROUND" ||
        code === "TNS_ROUND_RECAP_MISMATCH" ||
        code === "TNS_ROUND_RECAP_MISSING" ||
        code === "TNS_SCREEN_MISMATCH" ||
        code === "TNS_NEXT_ROUND_ID_MISMATCH",
      network: !stale && code === "TNS_UNKNOWN",
      error,
      result: null,
    };
  }
}
