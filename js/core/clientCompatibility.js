/**
 * ARCH-23 — service central de compatibilité client ↔ floor Supabase.
 *
 * État autoritaire `lastConfirmedIncompatible` (mémoire process) ≠ dernier recheck.
 * Un recheck `unknown` ne lève jamais une incompatibilité confirmée.
 */

import {
  CLIENT_COMPAT_ERROR,
  CLIENT_COMPAT_FRESH_MS,
  CLIENT_COMPAT_TIMEOUT_MS,
} from "../config/appCompatibility.js";
import { getInstalledClientBuild } from "./appBuildIdentity.js";
import {
  COMPAT_STATUS,
  compareCompatibilityBuilds,
  parseClientCompatibilityConfig,
} from "./clientCompatibilityContract.js";

/** @typedef {"boot"|"create"|"join"|"resume"|"foreground"|"manual"} CompatibilityCheckSource */

/** @type {null | object} */
let lastSuccessfulCompatible = null;

/** @type {null | object} — état autoritaire hard-gate */
let lastConfirmedIncompatible = null;

/** @type {null | object} — dernier résultat de recheck (peut être unknown) */
let lastRecheckResult = null;

/** @type {Promise<any>|null} */
let inFlight = null;

let lastHiddenAt = 0;

export function __resetClientCompatibilityForTests() {
  lastSuccessfulCompatible = null;
  lastConfirmedIncompatible = null;
  lastRecheckResult = null;
  inFlight = null;
  lastHiddenAt = 0;
}

export function markClientCompatAppHidden(at = Date.now()) {
  lastHiddenAt = at;
}

export function getClientCompatHiddenAt() {
  return lastHiddenAt;
}

export function getLastRecheckResult() {
  return lastRecheckResult;
}

/**
 * @param {object} result
 */
function logCompat(result, extra = {}) {
  try {
    console.info("[ARCH-23]", {
      platform: result.client?.platform,
      appVersion: result.client?.appVersion,
      nativeBuildNumber: result.client?.nativeBuildNumber,
      buildId: result.client?.buildId,
      compatibilityBuild: result.client?.compatibilityBuild,
      minCompatibilityBuild: result.minCompatibilityBuild ?? null,
      status: result.status,
      lastRecheckStatus: result.lastRecheckStatus ?? null,
      authoritativeIncompatible: Boolean(lastConfirmedIncompatible),
      source: result.source,
      checkedAt: result.checkedAt,
      durationMs: result.durationMs ?? null,
      reason: result.reason ?? null,
      ...extra,
    });
  } catch {
    /* ignore */
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error("client_compat_timeout");
      err.code = "TIMEOUT";
      reject(err);
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function fetchFloorFromServer() {
  const { isSupabaseConfigured, supabase } = await import("./supabaseClient.js");
  if (!isSupabaseConfigured()) {
    const err = new Error("supabase_not_configured");
    err.code = "NO_SUPABASE";
    throw err;
  }
  const { data, error } = await supabase.rpc("get_client_compatibility_config");
  if (error) {
    const err = new Error(error.message || "rpc_error");
    err.code = "RPC_ERROR";
    err.cause = error;
    throw err;
  }
  return data;
}

/**
 * Si un recheck force échoue en unknown alors qu’une incompatibilité est
 * confirmée : conserver l’autorité incompatible + exposer le recheck.
 * @param {object} unknownResult
 * @param {string} source
 */
function mergeUnknownWhileIncompatible(unknownResult, source) {
  const authoritative = {
    ...lastConfirmedIncompatible,
    status: COMPAT_STATUS.INCOMPATIBLE,
    lastRecheckStatus: COMPAT_STATUS.UNKNOWN,
    lastRecheckReason: unknownResult.reason || "unknown",
    source,
    reason: "authoritative_incompatible_recheck_unknown",
    checkedAt: unknownResult.checkedAt,
    durationMs: unknownResult.durationMs,
    client: unknownResult.client || lastConfirmedIncompatible.client,
    minCompatibilityBuild:
      lastConfirmedIncompatible.minCompatibilityBuild ??
      unknownResult.minCompatibilityBuild,
  };
  lastRecheckResult = unknownResult;
  logCompat(authoritative, { preservedAuthoritative: true });
  return authoritative;
}

/**
 * @param {{
 *   source?: CompatibilityCheckSource,
 *   force?: boolean,
 *   client?: object,
 *   fetchFloor?: () => Promise<unknown>,
 *   now?: number,
 *   timeoutMs?: number,
 *   freshMs?: number,
 * }} [opts]
 */
export async function checkClientCompatibility(opts = {}) {
  const source = opts.source || "manual";
  const force = Boolean(opts.force);
  const now = opts.now ?? Date.now();
  const freshMs = opts.freshMs ?? CLIENT_COMPAT_FRESH_MS;
  const timeoutMs = opts.timeoutMs ?? CLIENT_COMPAT_TIMEOUT_MS;

  if (
    !force &&
    lastConfirmedIncompatible?.status === COMPAT_STATUS.INCOMPATIBLE
  ) {
    const reused = {
      ...lastConfirmedIncompatible,
      source,
      reason: lastConfirmedIncompatible.reason || "cached_incompatible",
      lastRecheckStatus: lastRecheckResult?.status ?? null,
    };
    logCompat(reused, { cached: true });
    return reused;
  }

  if (
    !force &&
    lastSuccessfulCompatible?.status === COMPAT_STATUS.COMPATIBLE &&
    now - Date.parse(lastSuccessfulCompatible.checkedAt) < freshMs
  ) {
    const reused = { ...lastSuccessfulCompatible, source };
    logCompat(reused, { cached: true });
    return reused;
  }

  if (inFlight && !force) {
    return inFlight;
  }

  const run = (async () => {
    const started = Date.now();
    const client = opts.client || (await getInstalledClientBuild());
    const checkedAt = new Date(now).toISOString();

    try {
      const fetchFloor = opts.fetchFloor || fetchFloorFromServer;
      const raw = await withTimeout(fetchFloor(), timeoutMs);
      const parsed = parseClientCompatibilityConfig(raw);
      if (!parsed.ok) {
        const unknownResult = {
          status: COMPAT_STATUS.UNKNOWN,
          client,
          checkedAt,
          source,
          durationMs: Date.now() - started,
          reason: parsed.reason,
        };
        lastRecheckResult = unknownResult;
        if (lastConfirmedIncompatible) {
          return mergeUnknownWhileIncompatible(unknownResult, source);
        }
        logCompat(unknownResult);
        return unknownResult;
      }

      const status = compareCompatibilityBuilds(
        client.compatibilityBuild,
        parsed.minCompatibilityBuild
      );
      const result = {
        status,
        client,
        minCompatibilityBuild: parsed.minCompatibilityBuild,
        checkedAt,
        source,
        durationMs: Date.now() - started,
        lastRecheckStatus: status,
      };

      lastRecheckResult = result;

      if (status === COMPAT_STATUS.COMPATIBLE) {
        lastSuccessfulCompatible = result;
        lastConfirmedIncompatible = null;
      } else {
        lastConfirmedIncompatible = result;
        lastSuccessfulCompatible = null;
      }
      logCompat(result);
      return result;
    } catch (e) {
      const reason =
        e?.code === "TIMEOUT"
          ? "timeout"
          : e?.code === "NO_SUPABASE"
            ? "supabase_not_configured"
            : e?.code === "RPC_ERROR"
              ? "rpc_error"
              : "network_or_unexpected";
      const unknownResult = {
        status: COMPAT_STATUS.UNKNOWN,
        client,
        checkedAt,
        source,
        durationMs: Date.now() - started,
        reason,
      };
      lastRecheckResult = unknownResult;
      if (lastConfirmedIncompatible) {
        return mergeUnknownWhileIncompatible(unknownResult, source);
      }
      logCompat(unknownResult);
      return unknownResult;
    } finally {
      inFlight = null;
    }
  })();

  inFlight = run;
  return run;
}

/**
 * Gate métier — attendu, jamais fire-and-forget.
 *
 * @param {{
 *   source: CompatibilityCheckSource,
 *   force?: boolean,
 *   blockedAction?: string,
 *   checkFn?: typeof checkClientCompatibility,
 * }} opts
 */
export async function assertClientCompatibility(opts) {
  const checkFn = opts.checkFn || checkClientCompatibility;
  const result = await checkFn({
    source: opts.source,
    force: opts.force,
  });

  if (result.status === COMPAT_STATUS.COMPATIBLE) {
    return { ok: true, result, error: null };
  }

  if (result.status === COMPAT_STATUS.INCOMPATIBLE) {
    const recheckUnknown =
      result.lastRecheckStatus === COMPAT_STATUS.UNKNOWN;
    logCompat(result, {
      blockedAction: opts.blockedAction || opts.source,
      gate: "hard",
      recheckUnknown,
    });
    return {
      ok: false,
      blocked: true,
      status: COMPAT_STATUS.INCOMPATIBLE,
      result,
      error: CLIENT_COMPAT_ERROR.INCOMPATIBLE,
      recheckUnknown,
      message: recheckUnknown
        ? "Impossible de vérifier la mise à jour. Vérifie ta connexion, puis réessaie."
        : undefined,
    };
  }

  logCompat(result, {
    blockedAction: opts.blockedAction || opts.source,
    gate: "unknown",
  });
  return {
    ok: false,
    blocked: true,
    status: COMPAT_STATUS.UNKNOWN,
    result,
    error: CLIENT_COMPAT_ERROR.UNKNOWN,
    message:
      "Impossible de vérifier la compatibilité de l'application. Vérifie ta connexion et réessaie.",
  };
}

export function getLastConfirmedIncompatible() {
  return lastConfirmedIncompatible;
}

export function isClientCompatibilityHardBlocked() {
  return lastConfirmedIncompatible?.status === COMPAT_STATUS.INCOMPATIBLE;
}

export { CLIENT_COMPAT_ERROR };
