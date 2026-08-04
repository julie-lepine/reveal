/**
 * AUTH leave orphans - codes + interprétation preuve DELETE membership.
 * Pur / testable (sans Supabase).
 */

export const LOBBY_LEAVE_ERROR = Object.freeze({
  MISSING_LOBBY_ID: "LEAVE_MISSING_LOBBY_ID",
  MISSING_USER_ID: "LEAVE_MISSING_USER_ID",
  MISSING_IDENTITY: "LEAVE_MISSING_IDENTITY",
  DELETE_FAILED: "LEAVE_DELETE_FAILED",
  STILL_PRESENT: "LEAVE_MEMBERSHIP_STILL_PRESENT",
  VERIFY_FAILED: "LEAVE_VERIFY_FAILED",
});

export const LOBBY_LEAVE_USER_MESSAGE = Object.freeze({
  [LOBBY_LEAVE_ERROR.MISSING_LOBBY_ID]:
    "Impossible de quitter le lobby (session incomplète). Réessaie dans un instant.",
  [LOBBY_LEAVE_ERROR.MISSING_USER_ID]:
    "Impossible de quitter le lobby (connexion incomplète). Réessaie dans un instant.",
  [LOBBY_LEAVE_ERROR.MISSING_IDENTITY]:
    "Impossible de quitter le lobby (identité manquante). Réessaie dans un instant.",
  [LOBBY_LEAVE_ERROR.DELETE_FAILED]:
    "La connexion a empêché la sortie du lobby. Réessaie dans quelques instants.",
  [LOBBY_LEAVE_ERROR.STILL_PRESENT]:
    "La sortie du lobby n'a pas pu être confirmée. Réessaie dans quelques instants.",
  [LOBBY_LEAVE_ERROR.VERIFY_FAILED]:
    "Impossible de vérifier la sortie du lobby. Réessaie dans quelques instants.",
});

/**
 * @param {string} code
 * @param {string} [fallback]
 */
export function lobbyLeaveUserMessage(code, fallback) {
  if (code && LOBBY_LEAVE_USER_MESSAGE[code]) return LOBBY_LEAVE_USER_MESSAGE[code];
  return fallback || LOBBY_LEAVE_USER_MESSAGE[LOBBY_LEAVE_ERROR.DELETE_FAILED];
}

/**
 * Interprète DELETE + vérification ciblée.
 * @param {{
 *   deletedRows?: unknown[]|null,
 *   verifyStatus?: "absent"|"present"|"unknown",
 * }} input
 * @returns {{
 *   ok: boolean,
 *   deleted?: boolean,
 *   membershipAbsent?: boolean,
 *   code?: string,
 *   error?: string,
 * }}
 */
export function interpretMembershipDeleteProof(input = {}) {
  const rows = Array.isArray(input.deletedRows) ? input.deletedRows : [];
  if (rows.length > 0) {
    return { ok: true, deleted: true, membershipAbsent: false };
  }

  const status = input.verifyStatus;
  if (status === "absent") {
    return { ok: true, deleted: false, membershipAbsent: true };
  }
  if (status === "present") {
    return {
      ok: false,
      code: LOBBY_LEAVE_ERROR.STILL_PRESENT,
      error: lobbyLeaveUserMessage(LOBBY_LEAVE_ERROR.STILL_PRESENT),
    };
  }
  return {
    ok: false,
    code: LOBBY_LEAVE_ERROR.VERIFY_FAILED,
    error: lobbyLeaveUserMessage(LOBBY_LEAVE_ERROR.VERIFY_FAILED),
  };
}

/**
 * Préconditions leaveLobbySupabase (identité / lobby).
 * @returns {{ ok: true, lobbyId: string, userId: string } | { ok: false, code: string, error: string }}
 */
export function validateLeaveLobbySupabaseIdentity(lobbyId, userId) {
  const lid = lobbyId != null && String(lobbyId).trim() ? String(lobbyId).trim() : "";
  const uid = userId != null && String(userId).trim() ? String(userId).trim() : "";
  if (!lid && !uid) {
    return {
      ok: false,
      code: LOBBY_LEAVE_ERROR.MISSING_IDENTITY,
      error: lobbyLeaveUserMessage(LOBBY_LEAVE_ERROR.MISSING_IDENTITY),
    };
  }
  if (!lid) {
    return {
      ok: false,
      code: LOBBY_LEAVE_ERROR.MISSING_LOBBY_ID,
      error: lobbyLeaveUserMessage(LOBBY_LEAVE_ERROR.MISSING_LOBBY_ID),
    };
  }
  if (!uid) {
    return {
      ok: false,
      code: LOBBY_LEAVE_ERROR.MISSING_USER_ID,
      error: lobbyLeaveUserMessage(LOBBY_LEAVE_ERROR.MISSING_USER_ID),
    };
  }
  return { ok: true, lobbyId: lid, userId: uid };
}
