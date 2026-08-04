/**
 * Compensation join partiel - DELETE membership orpheline + restauration guestMembership.
 * Idempotent ; ne throw pas (rollback local toujours possible).
 */
import { withPatchTimeout } from "./withPatchTimeout.js";
import {
  clearGuestMembership,
  loadGuestMembership,
  saveGuestMembership,
} from "./guestMembership.js";
import {
  needsJoinCompensation,
  shouldCompensateMembershipDelete,
} from "./lobbyJoinEffects.js";

const PENDING_STORAGE_KEY = "reveal-pending-lobby-membership-compensation";
const COMPENSATION_DELETE_TIMEOUT_MS = 8000;

/** @typedef {'join_failed_after_membership_insert'|'join_failed_after_reclaim_delete_failed'|'delete_failed'} PendingCompensationReason */

/**
 * @typedef {{
 *   lobbyId: string,
 *   membershipId: string|null,
 *   createdAt: number,
 *   reason: PendingCompensationReason,
 *   lastError?: string|null,
 * }} PendingLobbyMembershipCompensation
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   membershipDeleted: boolean,
 *   guestMembershipRestored: boolean,
 *   pending: PendingLobbyMembershipCompensation|null,
 *   error?: string|null,
 * }} LobbyJoinCompensationResult
 */

/**
 * @typedef {{
 *   status: "membership_reconciliation_required",
 *   localLobbyId: string|null,
 *   remoteLobbyId: string,
 *   remoteCode: string|null,
 *   reason: PendingCompensationReason,
 *   pending: PendingLobbyMembershipCompensation,
 * }} MembershipReconciliationConflict
 */

/** @returns {PendingLobbyMembershipCompensation|null} */
export function getPendingLobbyMembershipCompensation() {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.lobbyId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** @param {PendingLobbyMembershipCompensation|null} pending */
export function savePendingLobbyMembershipCompensation(pending) {
  try {
    if (!pending?.lobbyId) {
      localStorage.removeItem(PENDING_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    /* storage indisponible */
  }
}

/** @param {string|null|undefined} lobbyId */
export function clearPendingLobbyMembershipCompensationIfMatches(lobbyId) {
  const pending = getPendingLobbyMembershipCompensation();
  if (!pending) return;
  if (!lobbyId || pending.lobbyId === lobbyId) {
    savePendingLobbyMembershipCompensation(null);
  }
}

/**
 * Bloque l'application silencieuse d'une membership query qui réactive le lobby pending.
 * @param {PendingLobbyMembershipCompensation|null|undefined} pending
 * @param {{ status?: string, membership?: { lobbyId?: string, code?: string } }|null|undefined} queryResult
 * @param {{ localLobbyId?: string|null }} [opts]
 */
export function shouldBlockMembershipQueryForPending(pending, queryResult, opts = {}) {
  if (!pending?.lobbyId) return false;
  if (queryResult?.status !== "found") return false;
  const remoteId = queryResult.membership?.lobbyId;
  if (!remoteId || String(remoteId) !== String(pending.lobbyId)) return false;
  const localLobbyId = opts.localLobbyId || null;
  if (localLobbyId && String(localLobbyId) === String(pending.lobbyId)) return false;
  return true;
}

/**
 * @param {PendingLobbyMembershipCompensation} pending
 * @param {{ status?: string, membership?: { lobbyId?: string, code?: string } }} queryResult
 * @param {string|null|undefined} localLobbyId
 * @returns {MembershipReconciliationConflict}
 */
export function buildMembershipReconciliationConflict(pending, queryResult, localLobbyId) {
  return {
    status: "membership_reconciliation_required",
    localLobbyId: localLobbyId || null,
    remoteLobbyId: pending.lobbyId,
    remoteCode: queryResult.membership?.code || null,
    reason: pending.reason,
    pending,
  };
}

/**
 * Restaure guestMembership à la valeur d'avant tentative si notre écriture est encore en place.
 * @param {import('./lobbyJoinEffects.js').LobbyJoinEffects} effects
 */
export function restoreGuestMembershipFromJoinEffects(effects) {
  if (!effects?.guestMembershipChanged) {
    return { restored: true, action: "none" };
  }

  const current = loadGuestMembership();
  const written = effects.guestMembershipWritten;

  if (written?.membershipId) {
    if (!current || current.membershipId !== written.membershipId) {
      return { restored: false, action: "skipped_changed", reason: "guest_membership_changed" };
    }
  }

  if (effects.previousGuestMembership) {
    saveGuestMembership(effects.previousGuestMembership);
    return { restored: true, action: "restored_previous" };
  }

  clearGuestMembership();
  return { restored: true, action: "cleared" };
}

/**
 * @param {import('./lobbyJoinEffects.js').LobbyJoinEffects} effects
 * @returns {PendingCompensationReason}
 */
function pendingReasonForFailedDelete(effects) {
  if (effects.membershipOrigin === "reclaimed") {
    return "join_failed_after_reclaim_delete_failed";
  }
  return "join_failed_after_membership_insert";
}

/**
 * @param {import('./lobbyJoinEffects.js').LobbyJoinEffects} effects
 * @param {string} [errorMessage]
 * @returns {PendingLobbyMembershipCompensation}
 */
function buildPendingFromEffects(effects, errorMessage, reason) {
  return {
    lobbyId: effects.targetLobbyId,
    membershipId: effects.targetMembershipId,
    createdAt: Date.now(),
    reason,
    lastError: errorMessage || null,
  };
}

/**
 * @param {string} lobbyId
 * @param {(lobbyId: string) => Promise<{ ok: boolean, error?: string }>} deleteFn
 */
async function attemptCompensationDelete(lobbyId, deleteFn) {
  return withPatchTimeout(
    deleteFn(lobbyId),
    COMPENSATION_DELETE_TIMEOUT_MS,
    "Compensation membership expirée."
  );
}

/**
 * @param {import('./lobbyJoinEffects.js').LobbyJoinEffects|null|undefined} effects
 * @param {{
 *   deleteOwnLobbyMembershipById?: (lobbyId: string) => Promise<{ ok: boolean, error?: string }>,
 * }} [deps]
 * @returns {Promise<LobbyJoinCompensationResult>}
 */
export async function compensateFailedLobbyJoin(effects, deps = {}) {
  const noop = {
    ok: true,
    membershipDeleted: false,
    guestMembershipRestored: false,
    pending: null,
  };
  if (!effects || !needsJoinCompensation(effects)) {
    return noop;
  }

  /** @type {LobbyJoinCompensationResult} */
  const result = {
    ok: true,
    membershipDeleted: false,
    guestMembershipRestored: false,
    pending: null,
  };

  if (shouldCompensateMembershipDelete(effects)) {
    const deleteFn = deps.deleteOwnLobbyMembershipById;
    const failReason = pendingReasonForFailedDelete(effects);
    if (typeof deleteFn !== "function") {
      result.ok = false;
      result.pending = buildPendingFromEffects(effects, "delete_unavailable", "delete_failed");
    } else {
      try {
        const delRes = await attemptCompensationDelete(effects.targetLobbyId, deleteFn);
        if (delRes?.ok) {
          result.membershipDeleted = true;
          clearPendingLobbyMembershipCompensationIfMatches(effects.targetLobbyId);
        } else {
          result.ok = false;
          result.error = delRes?.error || "delete_failed";
          result.pending = buildPendingFromEffects(effects, result.error, failReason);
        }
      } catch (err) {
        result.ok = false;
        result.error = err?.message || "delete_failed";
        result.pending = buildPendingFromEffects(effects, result.error, failReason);
      }
    }
  }

  const guestRestore = restoreGuestMembershipFromJoinEffects(effects);
  result.guestMembershipRestored = guestRestore.restored;

  if (result.pending) {
    savePendingLobbyMembershipCompensation(result.pending);
  } else if (result.membershipDeleted) {
    clearPendingLobbyMembershipCompensationIfMatches(effects.targetLobbyId);
  }

  return result;
}

/**
 * Retry idempotent d'une compensation en attente (ex. arrivée Home).
 * @param {{
 *   deleteOwnLobbyMembershipById?: (lobbyId: string) => Promise<{ ok: boolean, error?: string }>,
 * }} [deps]
 */
export async function retryPendingLobbyMembershipCompensation(deps = {}) {
  const pending = getPendingLobbyMembershipCompensation();
  if (!pending?.lobbyId) return { ok: true, retried: false };

  const deleteFn = deps.deleteOwnLobbyMembershipById;
  if (typeof deleteFn !== "function") {
    return { ok: false, retried: true, pending };
  }

  try {
    const delRes = await attemptCompensationDelete(pending.lobbyId, deleteFn);
    if (delRes?.ok) {
      clearPendingLobbyMembershipCompensationIfMatches(pending.lobbyId);
      return { ok: true, retried: true, membershipDeleted: true };
    }
    savePendingLobbyMembershipCompensation({
      ...pending,
      lastError: delRes?.error || "delete_failed",
    });
    return { ok: false, retried: true, pending, error: delRes?.error };
  } catch (err) {
    savePendingLobbyMembershipCompensation({
      ...pending,
      lastError: err?.message || "delete_failed",
    });
    return { ok: false, retried: true, pending, error: err?.message };
  }
}

/**
 * Résolution manuelle « Quitter B » depuis Home.
 * @param {{
 *   deleteOwnLobbyMembershipById?: (lobbyId: string) => Promise<{ ok: boolean, error?: string }>,
 * }} [deps]
 */
export async function resolvePendingMembershipByLeave(deps = {}) {
  const pending = getPendingLobbyMembershipCompensation();
  if (!pending?.lobbyId) return { ok: true, resolved: false };

  const deleteFn = deps.deleteOwnLobbyMembershipById;
  if (typeof deleteFn !== "function") {
    return { ok: false, resolved: false, pending, error: "delete_unavailable" };
  }

  try {
    const delRes = await attemptCompensationDelete(pending.lobbyId, deleteFn);
    if (delRes?.ok) {
      clearPendingLobbyMembershipCompensationIfMatches(pending.lobbyId);
      return { ok: true, resolved: true, membershipDeleted: true };
    }
    return { ok: false, resolved: false, pending, error: delRes?.error || "delete_failed" };
  } catch (err) {
    return { ok: false, resolved: false, pending, error: err?.message || "delete_failed" };
  }
}
