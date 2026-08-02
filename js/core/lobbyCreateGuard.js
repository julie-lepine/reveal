/**
 * Vague C — garde canonique de création de lobby (pure + décision injectable).
 * Vague E1 — décisions snapshot scoped par identité auth.
 */
import {
  getMembershipAuthGeneration,
} from "./lobbyMembershipSnapshot.js";

/** Fraîcheur chrome / canCreateLobby synchrone (pas une autorisation d'INSERT). */
export const MEMBERSHIP_SNAPSHOT_FRESH_MS = 30_000;

export const LOBBY_CREATE_ERROR = Object.freeze({
  CACHE_ACTIVE: "LOBBY_CACHE_ACTIVE",
  ALREADY_EXISTS: "LOBBY_MEMBERSHIP_ALREADY_EXISTS",
  CHECK_FAILED: "LOBBY_MEMBERSHIP_CHECK_FAILED",
  /** ARCH-23 — floor confirmé (≠ CHECK_FAILED membership). */
  CLIENT_INCOMPATIBLE: "CLIENT_INCOMPATIBLE",
  /** ARCH-23 — timeout / réseau / payload sans décision. */
  CLIENT_COMPAT_UNKNOWN: "CLIENT_COMPAT_UNKNOWN",
});

/**
 * @param {string} code
 * @param {string} message
 * @param {object} [extras]
 */
export function makeLobbyCreateError(code, message, extras = {}) {
  const err = new Error(message);
  err.name = "LobbyCreateError";
  err.code = code;
  Object.assign(err, extras);
  return err;
}

/**
 * Décision d'écriture snapshot après query (Home / create).
 *
 * @param {{ status?: string, userId?: string, membership?: { code?: string } }|null|undefined} previous
 * @param {{ status?: string, membership?: object, extraCount?: number }|null|undefined} result
 * @param {string} [source]
 * @param {{
 *   queryUserId?: string|null,
 *   currentUserId?: string|null,
 *   queryAuthGeneration?: number|null,
 *   currentAuthGeneration?: number|null,
 * }|null|undefined} [identity]
 */
export function decideMembershipSnapshotWrite(
  previous,
  result,
  source = "membership-query",
  identity = null
) {
  if (!result || typeof result !== "object" || !result.status) {
    return { action: "skip" };
  }

  const queryUserId = identity?.queryUserId ?? null;
  const currentUserId = identity?.currentUserId ?? null;
  const queryAuthGeneration = identity?.queryAuthGeneration;
  const currentAuthGeneration = identity?.currentAuthGeneration;

  if (queryUserId && currentUserId && queryUserId !== currentUserId) {
    return { action: "reject_stale_identity" };
  }

  if (
    queryAuthGeneration != null &&
    currentAuthGeneration != null &&
    queryAuthGeneration !== currentAuthGeneration
  ) {
    return { action: "reject_stale_identity" };
  }

  const effectiveUserId = currentUserId || queryUserId;
  if (!effectiveUserId) {
    return { action: "skip" };
  }

  if (previous?.userId && previous.userId !== effectiveUserId) {
    return { action: "reject_stale_identity" };
  }

  if (
    result.status === "unknown" &&
    previous?.status === "found" &&
    previous?.userId === effectiveUserId &&
    previous.membership?.code
  ) {
    return { action: "retain_found_same_identity" };
  }

  return { action: "write", result, source };
}

/**
 * @param {{ status?: string, checkedAt?: number }|null|undefined} snapshot
 * @param {number} [now]
 * @param {number} [freshMs]
 */
export function isMembershipSnapshotFresh(
  snapshot,
  now = Date.now(),
  freshMs = MEMBERSHIP_SNAPSHOT_FRESH_MS
) {
  if (!snapshot || typeof snapshot.checkedAt !== "number") return false;
  return now - snapshot.checkedAt >= 0 && now - snapshot.checkedAt <= freshMs;
}

/**
 * Dérivé synchrone — chrome / fast-fail. Pas une autorisation d'INSERT.
 */
export function canCreateLobbyFromInputs(input = {}) {
  const loggedIn = Boolean(input.loggedIn);
  const hasActiveLobby = Boolean(input.hasActiveLobby);
  const authReady = input.authReady !== false;
  const supabaseConfigured = Boolean(input.supabaseConfigured);
  const snapshot = input.snapshot ?? null;
  const now = input.now ?? Date.now();
  const freshMs = input.freshMs ?? MEMBERSHIP_SNAPSHOT_FRESH_MS;

  if (!loggedIn || hasActiveLobby) return false;

  if (!supabaseConfigured) return true;

  if (!authReady) return false;
  if (!snapshot?.userId) return false;
  if (snapshot.status !== "none") return false;
  if (!isMembershipSnapshotFresh(snapshot, now, freshMs)) return false;
  return true;
}

/**
 * Applique le résultat de query au snapshot (politique retain found same identity).
 * @returns {"wrote"|"retained"|"rejected"|"skipped"}
 */
export function applyMembershipQueryToSnapshot(
  result,
  {
    getMembershipSnapshot,
    setMembershipSnapshot,
    source = "create-lobby-guard",
    userId,
    queryAuthGeneration,
  }
) {
  const currentAuthGeneration = getMembershipAuthGeneration();
  const decision = decideMembershipSnapshotWrite(
    getMembershipSnapshot(),
    result,
    source,
    {
      queryUserId: userId,
      currentUserId: userId,
      queryAuthGeneration,
      currentAuthGeneration,
    }
  );
  if (decision.action === "retain_found_same_identity") return "retained";
  if (decision.action === "reject_stale_identity") return "rejected";
  if (decision.action === "write") {
    setMembershipSnapshot(decision.result, decision.source, userId);
    return "wrote";
  }
  return "skipped";
}

/**
 * Garde avant INSERT — injectable / testable sans client Supabase CDN.
 */
export async function assertCanInsertLobby(deps) {
  if (deps.hasActiveLobby) {
    const code = deps.activeLobbyCode || "?";
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CACHE_ACTIVE,
      `Quitte le lobby ${code} avant d'en créer un nouveau.`,
      { lobbyCode: code }
    );
  }

  if (typeof deps.queryActiveLobbyMembership !== "function") {
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CHECK_FAILED,
      "Impossible de vérifier votre situation. Réessayez."
    );
  }

  const queryUserId =
    typeof deps.getSupabaseUserId === "function" ? deps.getSupabaseUserId() : deps.userId;
  if (!queryUserId) {
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CHECK_FAILED,
      "Impossible de vérifier votre situation. Réessayez."
    );
  }

  const queryAuthGeneration = getMembershipAuthGeneration();

  let result;
  try {
    result = await deps.queryActiveLobbyMembership();
  } catch {
    result = { status: "unknown" };
  }

  if (!result || typeof result !== "object" || !result.status) {
    result = { status: "unknown" };
  }

  const currentUserId =
    typeof deps.getSupabaseUserId === "function" ? deps.getSupabaseUserId() : queryUserId;
  if (
    currentUserId !== queryUserId ||
    getMembershipAuthGeneration() !== queryAuthGeneration
  ) {
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CHECK_FAILED,
      "Impossible de vérifier votre situation. Réessayez."
    );
  }

  applyMembershipQueryToSnapshot(result, {
    getMembershipSnapshot: deps.getMembershipSnapshot,
    setMembershipSnapshot: deps.setMembershipSnapshot,
    source: "create-lobby-guard",
    userId: queryUserId,
    queryAuthGeneration,
  });

  if (result.status === "found") {
    const code = result.membership?.code || "?";
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.ALREADY_EXISTS,
      `Tu es déjà dans le lobby ${code}. Quitte-le avant d'en créer un nouveau.`,
      { lobbyCode: code, membership: result.membership || null }
    );
  }

  if (result.status !== "none") {
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CHECK_FAILED,
      "Impossible de vérifier votre situation. Réessayez."
    );
  }

  return { status: "none" };
}
