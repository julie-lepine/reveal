/**
 * Snapshot mémoire de résolution membership (Vague A).
 *
 * Cache uniquement — jamais SoT. Pas de sessionStorage / localStorage / Home / UI.
 * Stocke exactement le résultat passé (pas de règle « conserver found face à unknown »
 * — politique Vague B).
 *
 * Contrat copie défensive :
 * - set reconstruit toujours un nouvel objet interne ;
 * - membership shallow-copié à l’écriture ;
 * - get et la valeur retournée par set n’exposent jamais la référence interne ;
 * - shallow copy snapshot + membership (pas d’obligation structuredClone) ;
 * - invalidate → null (non résolu), jamais `{ status: "none" }`.
 */

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
 *   membership?: ActiveLobbyMembership,
 *   extraCount?: number,
 *   checkedAt: number,
 *   source?: string|null,
 * }} MembershipSnapshot
 */

/** @type {MembershipSnapshot|null} */
let snapshot = null;

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
 * Construit un snapshot défensif depuis un résultat de query.
 * found → none|unknown : membership / extraCount absents du résultat → absents du snap.
 * @param {{ status: string, membership?: ActiveLobbyMembership, extraCount?: number }} result
 * @param {string|null|undefined} source
 * @returns {MembershipSnapshot}
 */
function buildSnapshot(result, source) {
  /** @type {MembershipSnapshot} */
  const next = {
    status: result.status,
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

function expose(snap) {
  if (!snap) return null;
  /** @type {MembershipSnapshot} */
  const out = {
    status: snap.status,
    checkedAt: snap.checkedAt,
    source: snap.source ?? null,
  };
  if (snap.membership) out.membership = shallowMembership(snap.membership);
  if (typeof snap.extraCount === "number") out.extraCount = snap.extraCount;
  return out;
}

/** @returns {MembershipSnapshot|null} */
export function getMembershipSnapshot() {
  return expose(snapshot);
}

/**
 * @param {{ status: string, membership?: ActiveLobbyMembership, extraCount?: number }} result
 * @param {string|null} [source]
 * @returns {MembershipSnapshot}
 */
export function setMembershipSnapshot(result, source) {
  snapshot = buildSnapshot(result, source);
  return expose(snapshot);
}

/** Invalide → null (non résolu). */
export function invalidateMembershipSnapshot() {
  snapshot = null;
}
