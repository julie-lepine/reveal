/**
 * Snapshot mémoire de résolution membership (Vague A + E1 scope identité).
 *
 * Cache uniquement — jamais SoT. Pas de sessionStorage / localStorage.
 * Chaque snapshot serveur (`none` | `found` | `unknown`) est lié à un `userId`
 * et une génération auth monotone ; les lectures sont scoped à l'utilisateur courant.
 */
import { getState } from "./state.js";

/**
 * @typedef {{
 *   lobbyId: string,
 *   code: string,
 *   lobbyStatus: string|null,
 *   gameId: string|null,
 *   role: "host"|"member",
 * }} ActiveLobbyMembership
 *
 * @typedef {{
 *   status: "none"|"found"|"unknown",
 *   userId: string,
 *   authGeneration: number,
 *   membership?: ActiveLobbyMembership,
 *   extraCount?: number,
 *   checkedAt: number,
 *   source?: string|null,
 * }} MembershipSnapshot
 */

/** @type {MembershipSnapshot|null} */
let snapshot = null;

/** Génération auth monotone — bump uniquement sur changement d'identité userId. */
let membershipAuthGeneration = 0;

function shallowMembership(m) {
  if (!m || typeof m !== "object") return undefined;
  return {
    lobbyId: m.lobbyId,
    code: m.code,
    lobbyStatus: m.lobbyStatus ?? null,
    gameId: m.gameId ?? null,
    role: m.role,
  };
}

/**
 * @param {{ status: string, membership?: ActiveLobbyMembership, extraCount?: number }} result
 * @param {string|null|undefined} source
 * @param {string} userId
 * @param {number} authGeneration
 * @returns {MembershipSnapshot}
 */
function buildSnapshot(result, source, userId, authGeneration) {
  /** @type {MembershipSnapshot} */
  const next = {
    status: result.status,
    userId,
    authGeneration,
    checkedAt: Date.now(),
    source: source !== undefined ? source : null,
  };

  if (result.status === "found") {
    const membership = shallowMembership(result.membership);
    if (membership) next.membership = membership;
    if (typeof result.extraCount === "number") next.extraCount = result.extraCount;
  }

  return next;
}

/** @param {MembershipSnapshot|null} snap */
function expose(snap) {
  if (!snap?.userId) return null;
  /** @type {MembershipSnapshot} */
  const out = {
    status: snap.status,
    userId: snap.userId,
    authGeneration: snap.authGeneration,
    checkedAt: snap.checkedAt,
    source: snap.source ?? null,
  };
  if (snap.membership) out.membership = shallowMembership(snap.membership);
  if (typeof snap.extraCount === "number") out.extraCount = snap.extraCount;
  return out;
}

/** @returns {string|null} */
export function getCurrentMembershipUserId() {
  return getState().supabaseUserId || null;
}

/** @returns {number} */
export function getMembershipAuthGeneration() {
  return membershipAuthGeneration;
}

/**
 * Transition d'identité auth (A→B, A→signed out, guest→user…).
 * Idempotent si prev === next. Ne bump pas sur refresh token même userId.
 * @param {string|null|undefined} previousUserId
 * @param {string|null|undefined} nextUserId
 */
export function handleMembershipAuthIdentityTransition(previousUserId, nextUserId) {
  const prev = previousUserId || null;
  const next = nextUserId || null;
  if (prev === next) return { changed: false, authGeneration: membershipAuthGeneration };
  invalidateMembershipSnapshot();
  membershipAuthGeneration += 1;
  return { changed: true, authGeneration: membershipAuthGeneration };
}

/** Invalide → null (non résolu). Idempotent. Ne bump pas la génération auth. */
export function invalidateMembershipSnapshot() {
  snapshot = null;
}

/**
 * Lecture scoped — snapshot d'un autre userId ou legacy sans userId → null.
 * @param {string|null|undefined} userId
 * @returns {MembershipSnapshot|null}
 */
export function getMembershipSnapshotForUser(userId) {
  if (!userId || !snapshot?.userId) return null;
  if (snapshot.userId !== userId) return null;
  if (snapshot.authGeneration !== membershipAuthGeneration) return null;
  return expose(snapshot);
}

/**
 * Lecture pour l'utilisateur Supabase courant (state.supabaseUserId).
 * Signed out → null (aucune membership serveur exposable).
 * @returns {MembershipSnapshot|null}
 */
export function getMembershipSnapshot() {
  return getMembershipSnapshotForUser(getCurrentMembershipUserId());
}

/**
 * @param {{ status: string, membership?: ActiveLobbyMembership, extraCount?: number }} result
 * @param {string|null|undefined} [source]
 * @param {string|null|undefined} [userId]
 * @param {{ authGeneration?: number }|null} [opts]
 * @returns {MembershipSnapshot|null}
 */
export function setMembershipSnapshot(result, source, userId, opts = null) {
  const uid = userId || null;
  if (!uid || !result?.status) return null;
  const gen = opts?.authGeneration ?? membershipAuthGeneration;
  snapshot = buildSnapshot(result, source, uid, gen);
  return expose(snapshot);
}

/** Tests uniquement. */
export function __resetMembershipAuthForTests() {
  snapshot = null;
  membershipAuthGeneration = 0;
}
