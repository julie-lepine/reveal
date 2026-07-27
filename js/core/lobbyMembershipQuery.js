/**
 * Lecture canonique ternaire membership lobby (Vague A).
 *
 * SoT métier MP : row `lobby_members` jointe à un `lobbies` vivant.
 * Pas de filtre d’âge 24 h. Pas de hints remember/guest pour décider.
 * Aucun effet de bord : pas d’hydrate, navigate, reclaim, clear local,
 * **pas d’écriture snapshot** (ni state.inLobby / lobby / lobbyCode).
 *
 * Homonymie :
 *   - `queryActiveLobbyMembership(deps)` ici = variante **injectable / tests**.
 *   - Runtime production : importer depuis `lobbyMembershipFetch.js`
 *     (signature `queryActiveLobbyMembership(userId?)` câblée Supabase).
 * Éviter d’importer les deux signatures depuis un même contexte ambigu.
 */

/** Limite défensive alignée sur le fetch PostgREST production. */
export const ACTIVE_MEMBERSHIP_QUERY_LIMIT = 20;

/**
 * @typedef {{
 *   lobbyId: string,
 *   joinedAt?: string|null,
 *   code: string,
 *   lobbyStatus?: string|null,
 *   gameId?: string|null,
 *   hostId?: string|null,
 * }} LivingMembershipRow
 *
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
 * }} MembershipQueryResult
 */

/**
 * Tri défensif (pas politique produit) : joined_at DESC, tie-break lobbyId ASC.
 * @param {LivingMembershipRow} a
 * @param {LivingMembershipRow} b
 */
export function compareMembershipRowsDeterministic(a, b) {
  const ta = Date.parse(a?.joinedAt ?? "") || 0;
  const tb = Date.parse(b?.joinedAt ?? "") || 0;
  if (tb !== ta) return tb - ta;
  return String(a?.lobbyId || "").localeCompare(String(b?.lobbyId || ""));
}

/**
 * @param {LivingMembershipRow} row
 * @param {string} userId
 * @returns {ActiveLobbyMembership|null}
 */
export function membershipFromLivingRow(row, userId) {
  if (!row?.lobbyId || !row?.code) return null;
  const isHost =
    Boolean(row.hostId) &&
    Boolean(userId) &&
    String(row.hostId) === String(userId);
  return {
    lobbyId: String(row.lobbyId),
    code: String(row.code),
    lobbyStatus: row.lobbyStatus != null ? String(row.lobbyStatus) : null,
    gameId: row.gameId != null ? String(row.gameId) : null,
    // Données manquantes → member (défaut défensif).
    role: isHost ? "host" : "member",
  };
}

/** @returns {MembershipQueryResult} */
export function membershipQueryNone() {
  return { status: "none" };
}

/** @returns {MembershipQueryResult} */
export function membershipQueryUnknown() {
  return { status: "unknown" };
}

function isValidLivingRow(row) {
  return Boolean(row?.lobbyId && row?.code);
}

/**
 * Interprète des LivingRows déjà normalisées (pas de filtre âge).
 * Multi-memberships : état serveur anormal — sélection déterministe défensive,
 * extraCount, log borné ; aucune mutation / leave / delete.
 * Nettoyage serveur = ticket séparé.
 *
 * @param {string} userId
 * @param {LivingMembershipRow[]|null|undefined} rows
 * @param {{ logMulti?: (payload: object) => void }} [opts]
 * @returns {MembershipQueryResult}
 */
export function interpretLivingMembershipRows(userId, rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const valid = list.filter(isValidLivingRow);
  if (valid.length === 0) return membershipQueryNone();

  const sorted = [...valid].sort(compareMembershipRowsDeterministic);
  const chosen = sorted[0];
  const membership = membershipFromLivingRow(chosen, userId);
  if (!membership) return membershipQueryNone();

  const extraCount = sorted.length - 1;
  if (extraCount > 0 && typeof opts.logMulti === "function") {
    const uid = String(userId || "");
    opts.logMulti({
      uidTruncated: uid ? `${uid.slice(0, 8)}…` : null,
      count: sorted.length,
      lobbyIdsSample: sorted.slice(0, 5).map((r) => r.lobbyId),
    });
  }

  return {
    status: "found",
    membership,
    extraCount,
  };
}

/**
 * Variante injectable (tests / deps). Pas l’API runtime.
 *
 * deps : `{ userId?, getUserId?, isSupabaseConfigured?, fetchLivingMembershipRows, logMulti? }`
 * - deps invalides / !configured / !userId / throw / `{ ok: false }` → `unknown`
 * - `{ ok: true, rows }` → interpret (`rows || []` seulement après ok:true)
 * Jamais convertir une erreur technique en `none`.
 *
 * @param {{
 *   userId?: string|null,
 *   getUserId?: () => string|null|undefined,
 *   isSupabaseConfigured?: boolean|(() => boolean),
 *   fetchLivingMembershipRows?: (userId: string) => Promise<{ ok: boolean, rows?: LivingMembershipRow[], error?: unknown }>,
 *   logMulti?: (payload: object) => void,
 * }} [deps]
 * @returns {Promise<MembershipQueryResult>}
 */
export async function queryActiveLobbyMembership(deps = {}) {
  try {
    if (!deps || typeof deps !== "object") return membershipQueryUnknown();
    if (typeof deps.fetchLivingMembershipRows !== "function") {
      return membershipQueryUnknown();
    }

    const configured =
      typeof deps.isSupabaseConfigured === "function"
        ? deps.isSupabaseConfigured()
        : deps.isSupabaseConfigured;
    if (configured === false) return membershipQueryUnknown();

    let userId = deps.userId;
    if (userId == null && typeof deps.getUserId === "function") {
      userId = deps.getUserId();
    }
    if (!userId) return membershipQueryUnknown();

    const fetchResult = await deps.fetchLivingMembershipRows(userId);
    if (!fetchResult || fetchResult.ok !== true) return membershipQueryUnknown();

    return interpretLivingMembershipRows(userId, fetchResult.rows || [], {
      logMulti: deps.logMulti,
    });
  } catch {
    return membershipQueryUnknown();
  }
}
