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
 * Normalise une row membership déjà connue (RPC / INSERT / select id).
 * Formes acceptées : PostgREST `{ id, lobby_id, joined_at, is_host, user_id }`,
 * canonique `{ membershipId, lobbyId, joinedAt, role }`, tableau (1ʳᵉ ligne), id string.
 *
 * @param {unknown} raw
 * @param {{ userId?: string|null, lobbyIdHint?: string|null }} [ctx]
 * @returns {Partial<ActiveLobbyMembership>&{ lobbyId?: string }|null}
 */
export function normalizeCanonicalMembershipRow(raw, ctx = {}) {
  if (raw == null) return null;
  let row = raw;
  if (Array.isArray(row)) row = row[0];
  if (typeof row === "string" || typeof row === "number") {
    const lobbyId = ctx.lobbyIdHint ? String(ctx.lobbyIdHint) : null;
    if (!lobbyId) return null;
    return { lobbyId, membershipId: String(row) };
  }
  if (!row || typeof row !== "object") return null;

  const r = /** @type {Record<string, unknown>} */ (row);
  const membershipId =
    r.membershipId != null
      ? String(r.membershipId)
      : r.id != null
        ? String(r.id)
        : null;
  const lobbyId =
    r.lobbyId != null
      ? String(r.lobbyId)
      : r.lobby_id != null
        ? String(r.lobby_id)
        : ctx.lobbyIdHint
          ? String(ctx.lobbyIdHint)
          : null;
  if (!lobbyId) return null;

  /** @type {Partial<ActiveLobbyMembership> & { lobbyId: string }} */
  const out = { lobbyId };
  if (membershipId) out.membershipId = membershipId;
  if (r.joinedAt != null) out.joinedAt = String(r.joinedAt);
  else if (r.joined_at != null) out.joinedAt = String(r.joined_at);

  if (r.role === "host" || r.role === "member") {
    out.role = r.role;
  } else if (typeof r.is_host === "boolean") {
    out.role = r.is_host ? "host" : "member";
  } else if (typeof r.isHost === "boolean") {
    out.role = r.isHost ? "host" : "member";
  }

  if (r.hostId != null) out.hostId = String(r.hostId);
  else if (r.host_id != null) out.hostId = String(r.host_id);

  return out;
}

/**
 * Bundle + row canonique optionnelle → ActiveLobbyMembership.
 * Priorité canonique : membershipId, joinedAt, role ; bundle : code, status, gameId, hostId.
 *
 * @param {{
 *   bundle?: object|null,
 *   userId: string,
 *   canonicalRow?: unknown,
 * }} input
 * @returns {ActiveLobbyMembership|null}
 */
export function buildHydratedMembership(input) {
  const { bundle, userId, canonicalRow } = input;
  const fromBundle = membershipFromHydratedBundle(bundle, userId);
  const fromCanon = normalizeCanonicalMembershipRow(canonicalRow, {
    userId,
    lobbyIdHint: bundle?.id || fromBundle?.lobbyId || null,
  });

  if (!fromBundle && !fromCanon) return null;
  if (!fromBundle) {
    // Row seule sans code lobby → insuffisant pour un found Resume.
    return null;
  }
  if (!fromCanon) return fromBundle;

  if (fromCanon.lobbyId !== fromBundle.lobbyId) {
    // Hydratation ciblée sur le bundle confirmé : ignorer une row d’un autre lobby.
    return fromBundle;
  }

  /** @type {ActiveLobbyMembership} */
  const merged = { ...fromBundle };
  if (fromCanon.membershipId) merged.membershipId = fromCanon.membershipId;
  if (fromCanon.joinedAt != null) merged.joinedAt = fromCanon.joinedAt;
  if (fromCanon.role) merged.role = fromCanon.role;
  if (fromCanon.hostId) merged.hostId = fromCanon.hostId;
  return merged;
}

/**
 * @param {{
 *   id?: string,
 *   code?: string,
 *   status?: string|null,
 *   gameId?: string|null,
 *   hostId?: string|null,
 *   participants?: Array<{
 *     userId?: string,
 *     isLocal?: boolean,
 *     isHost?: boolean,
 *     membershipId?: string,
 *     joinedAt?: string|null,
 *   }>,
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
  if (local?.joinedAt != null) {
    membership.joinedAt = String(local.joinedAt);
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
 *   canonicalRow?: unknown,
 *   extraCount?: number,
 *   localLobbyId?: string|null,
 * }} input
 */
export function alignMembershipSnapshotAfterLobbyHydration(input) {
  const userId = input.userId || getCurrentMembershipUserId();
  if (!userId) return { action: "skipped", reason: "no_user" };

  const membership = buildHydratedMembership({
    bundle: input.bundle,
    userId,
    canonicalRow: input.canonicalRow,
  });
  if (!membership) return { action: "skipped", reason: "no_membership_from_bundle" };

  return commitMembershipHydrated({
    userId,
    membership,
    extraCount: input.extraCount,
    source: input.source,
    localLobbyId: input.localLobbyId,
  });
}
