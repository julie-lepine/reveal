/**
 * AUTH-LEAVE-SILENT-OK-01 — DELETE membership avec preuve (deps injectées).
 * Pur / testable sans charger le client Supabase.
 */
import {
  LOBBY_LEAVE_ERROR,
  interpretMembershipDeleteProof,
  lobbyLeaveUserMessage,
} from "./lobbyLeaveContract.js";

/**
 * @param {string} lobbyId
 * @param {{
 *   getUserId: () => string|null|undefined,
 *   deleteAndReturnRows: (lobbyId: string, userId: string) => Promise<
 *     { ok: true, rows: unknown[] } | { ok: false, error?: string }
 *   >,
 *   verifyMembershipAbsent: (lobbyId: string, userId: string) => Promise<
 *     { status: "absent"|"present"|"unknown", error?: string }
 *   >,
 * }} deps
 * @returns {Promise<{
 *   ok: boolean,
 *   deleted?: boolean,
 *   membershipAbsent?: boolean,
 *   code?: string,
 *   error?: string,
 * }>}
 */
export async function deleteOwnLobbyMembershipByIdWithDeps(lobbyId, deps) {
  if (!deps?.getUserId || !deps?.deleteAndReturnRows || !deps?.verifyMembershipAbsent) {
    throw new Error("deleteOwnLobbyMembershipByIdWithDeps: deps required");
  }

  const lid = lobbyId != null && String(lobbyId).trim() ? String(lobbyId).trim() : "";
  const userId = deps.getUserId();
  const uid = userId != null && String(userId).trim() ? String(userId).trim() : "";

  if (!lid || !uid) {
    const code = !lid && !uid
      ? LOBBY_LEAVE_ERROR.MISSING_IDENTITY
      : !lid
        ? LOBBY_LEAVE_ERROR.MISSING_LOBBY_ID
        : LOBBY_LEAVE_ERROR.MISSING_USER_ID;
    return {
      ok: false,
      code,
      error: lobbyLeaveUserMessage(code, "Authentification ou lobbyId manquant."),
    };
  }

  let del;
  try {
    del = await deps.deleteAndReturnRows(lid, uid);
  } catch (e) {
    return {
      ok: false,
      code: LOBBY_LEAVE_ERROR.DELETE_FAILED,
      error: lobbyLeaveUserMessage(
        LOBBY_LEAVE_ERROR.DELETE_FAILED,
        e?.message || String(e)
      ),
    };
  }

  if (!del?.ok) {
    return {
      ok: false,
      code: LOBBY_LEAVE_ERROR.DELETE_FAILED,
      error: lobbyLeaveUserMessage(
        LOBBY_LEAVE_ERROR.DELETE_FAILED,
        del?.error || "Impossible de quitter le lobby."
      ),
    };
  }

  const rows = Array.isArray(del.rows) ? del.rows : [];
  if (rows.length > 0) {
    return interpretMembershipDeleteProof({ deletedRows: rows });
  }

  let verify;
  try {
    verify = await deps.verifyMembershipAbsent(lid, uid);
  } catch (e) {
    return {
      ok: false,
      code: LOBBY_LEAVE_ERROR.VERIFY_FAILED,
      error: lobbyLeaveUserMessage(
        LOBBY_LEAVE_ERROR.VERIFY_FAILED,
        e?.message || String(e)
      ),
    };
  }

  const status =
    verify?.status === "absent" || verify?.status === "present"
      ? verify.status
      : "unknown";

  return interpretMembershipDeleteProof({
    deletedRows: [],
    verifyStatus: status,
  });
}
