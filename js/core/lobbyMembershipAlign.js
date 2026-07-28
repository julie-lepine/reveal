/**
 * Vague E2 — alignement asymétrique snapshot membership ↔ commits serveur confirmés.
 *
 * Le snapshot = dernière connaissance membership serveur (pas une copie du cache runtime).
 * Promotion uniquement sur sources confirmées ; clear local ne retire pas un found récupérable.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/supabase.js";
import {
  getMembershipAuthGeneration,
  getMembershipSnapshotForUser,
  getCurrentMembershipUserId,
  setMembershipSnapshot,
  invalidateMembershipSnapshot,
} from "./lobbyMembershipSnapshot.js";
import {
  getPendingLobbyMembershipCompensation,
  shouldBlockMembershipQueryForPending,
} from "./lobbyMembershipCompensation.js";
import { getState } from "./state.js";

function isSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  if (SUPABASE_URL.includes("TON_PROJECT")) return false;
  if (SUPABASE_ANON_KEY.includes("REPLACE_ME")) return false;
  return true;
}

/** @typedef {import("./lobbyMembershipSnapshot.js").ActiveLobbyMembership} ActiveLobbyMembership */

export const MEMBERSHIP_HYDRATION_SOURCE = Object.freeze({
  CREATE_CONFIRMED: "create_confirmed",
  JOIN_CONFIRMED: "join_confirmed",
  RECOVER_CONFIRMED: "recover_confirmed",
  REFRESH_CONFIRMED: "refresh_confirmed",
});

const ALLOWED_HYDRATION_SOURCES = new Set(Object.values(MEMBERSHIP_HYDRATION_SOURCE));

/** Champs runtime autoritaires lors d'un refresh (bundle / cache hydraté). */
const RUNTIME_AUTHORITATIVE_KEYS = ["lobbyStatus", "gameId", "code", "role"];

/**
 * @param {{
 *   id?: string,
 *   code?: string,
 *   status?: string|null,
 *   gameId?: string|null,
 *   hostId?: string|null,
 *   participants?: Array<{ userId?: string, isLocal?: boolean, isHost?: boolean, membershipId?: string }>,
 * }|null|undefined} bundle
 * @param {string|null|undefined} userId
 * @returns {ActiveLobbyMembership|null}
 */
export function membershipFromHydratedBundle(bundle, userId) {
  if (!bundle?.id || !bundle?.code || !userId) return null;

  const local =
    (bundle.participants || []).find((p) => p.isLocal) ||
    (bundle.participants || []).find((p) => p.userId === userId);

  const isHost =
    Boolean(bundle.hostId) && String(bundle.hostId) === String(userId);

  /** @type {ActiveLobbyMembership} */
  const membership = {
    lobbyId: String(bundle.id),
    code: String(bundle.code),
    lobbyStatus: bundle.status != null ? String(bundle.status) : null,
    gameId: bundle.gameId != null ? String(bundle.gameId) : null,
    role: isHost || local?.isHost ? "host" : "member",
  };

  if (local?.membershipId) {
    membership.membershipId = String(local.membershipId);
  }
  if (bundle.hostId) {
    membership.hostId = String(bundle.hostId);
  }

  return membership;
}

/**
 * Fusionne métadonnées — même lobbyId uniquement.
 * @param {ActiveLobbyMembership|null|undefined} existing
 * @param {ActiveLobbyMembership|null|undefined} incoming
 * @returns {ActiveLobbyMembership|null}
 */
export function mergeMembershipFields(existing, incoming) {
  if (!incoming?.lobbyId || !incoming?.code) return existing || null;
  if (!existing?.lobbyId || existing.lobbyId !== incoming.lobbyId) {
    return { ...incoming };
  }

  /** @type {ActiveLobbyMembership} */
  const merged = { ...existing };

  for (const key of Object.keys(incoming)) {
    const val = incoming[key];
    if (val === undefined || val === null) continue;
    if (RUNTIME_AUTHORITATIVE_KEYS.includes(key)) {
      merged[key] = val;
    } else if (merged[key] == null) {
      merged[key] = val;
    }
  }

  merged.lobbyId = incoming.lobbyId;
  merged.code = incoming.code;
  merged.role = incoming.role ?? merged.role ?? "member";

  return merged;
}

/**
 * @param {ActiveLobbyMembership|null|undefined} a
 * @param {ActiveLobbyMembership|null|undefined} b
 */
function membershipRuntimeFieldsEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.lobbyId === b.lobbyId &&
    a.code === b.code &&
    a.role === b.role &&
    (a.lobbyStatus ?? null) === (b.lobbyStatus ?? null) &&
    (a.gameId ?? null) === (b.gameId ?? null)
  );
}

/**
 * @param {import("./lobbyMembershipSnapshot.js").MembershipSnapshot|null|undefined} existing
 * @param {ActiveLobbyMembership} membership
 * @param {string} source
 */
export function shouldAlignSnapshotOnRefresh(existing, membership, source) {
  if (source !== MEMBERSHIP_HYDRATION_SOURCE.REFRESH_CONFIRMED) return true;
  if (!existing || existing.status !== "found") return true;
  if (existing.membership?.lobbyId !== membership.lobbyId) return true;
  const merged = mergeMembershipFields(existing.membership, membership);
  return !membershipRuntimeFieldsEqual(existing.membership, merged);
}

/**
 * @param {{
 *   userId: string,
 *   membership: ActiveLobbyMembership,
 *   extraCount?: number,
 *   source: string,
 *   authGeneration?: number,
 *   localLobbyId?: string|null,
 * }} input
 * @returns {{ action: "wrote"|"skipped"|"rejected", reason?: string }}
 */
export function commitMembershipHydrated(input) {
  const { userId, membership, extraCount, source } = input;

  if (!isSupabaseConfigured()) {
    return { action: "skipped", reason: "offline" };
  }
  if (!userId || !membership?.lobbyId || !membership?.code) {
    return { action: "skipped", reason: "invalid_membership" };
  }
  if (!ALLOWED_HYDRATION_SOURCES.has(source)) {
    return { action: "rejected", reason: "invalid_source" };
  }

  const currentUserId = getCurrentMembershipUserId();
  if (currentUserId !== userId) {
    return { action: "rejected", reason: "identity_mismatch" };
  }

  const authGeneration = input.authGeneration ?? getMembershipAuthGeneration();
  if (authGeneration !== getMembershipAuthGeneration()) {
    return { action: "rejected", reason: "stale_auth_generation" };
  }

  const pending = getPendingLobbyMembershipCompensation();
  const localLobbyId =
    input.localLobbyId !== undefined ? input.localLobbyId : getState().lobby?.id || null;
  if (
    shouldBlockMembershipQueryForPending(
      pending,
      { status: "found", membership },
      { localLobbyId }
    )
  ) {
    return { action: "rejected", reason: "pending_compensation" };
  }

  const existing = getMembershipSnapshotForUser(userId);
  let finalMembership = membership;

  if (
    existing?.status === "found" &&
    existing.membership?.lobbyId === membership.lobbyId
  ) {
    finalMembership = mergeMembershipFields(existing.membership, membership);
    if (
      source === MEMBERSHIP_HYDRATION_SOURCE.REFRESH_CONFIRMED &&
      !shouldAlignSnapshotOnRefresh(existing, membership, source)
    ) {
      return { action: "skipped", reason: "unchanged" };
    }
  }

  setMembershipSnapshot(
    {
      status: "found",
      membership: finalMembership,
      extraCount: typeof extraCount === "number" ? extraCount : existing?.extraCount,
    },
    source,
    userId,
    { authGeneration }
  );

  return { action: "wrote" };
}

/**
 * Retire le snapshot found d'une membership supprimée côté serveur (sans faux none).
 * @param {{ userId: string, lobbyId?: string|null }} input
 * @returns {{ action: "removed"|"skipped", reason?: string }}
 */
export function commitMembershipRemoved(input) {
  const { userId, lobbyId } = input;
  if (!userId) return { action: "skipped", reason: "no_user" };

  const snap = getMembershipSnapshotForUser(userId);
  if (!snap || snap.status !== "found") {
    return { action: "skipped", reason: "no_found_snapshot" };
  }
  if (lobbyId && snap.membership?.lobbyId !== lobbyId) {
    return { action: "skipped", reason: "lobby_mismatch" };
  }

  invalidateMembershipSnapshot();
  return { action: "removed" };
}

/**
 * @param {{
 *   bundle: object,
 *   userId: string|null|undefined,
 *   source: string,
 *   extraCount?: number,
 *   localLobbyId?: string|null,
 * }} input
 */
export function alignMembershipSnapshotAfterLobbyHydration(input) {
  const userId = input.userId || getCurrentMembershipUserId();
  if (!userId) return { action: "skipped", reason: "no_user" };

  const membership = membershipFromHydratedBundle(input.bundle, userId);
  if (!membership) return { action: "skipped", reason: "no_membership_from_bundle" };

  return commitMembershipHydrated({
    userId,
    membership,
    extraCount: input.extraCount,
    source: input.source,
    localLobbyId: input.localLobbyId,
  });
}
