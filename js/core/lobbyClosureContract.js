/**
 * BUG-LOBBY-XX-E — mapping RPC get_lobby_closure (pur).
 */

import { LOBBY_CLOSURE_REASON } from "./lobbyClosureCopy.js";

export { LOBBY_CLOSURE_REASON };

export const LOBBY_CLOSURE_FETCH = Object.freeze({
  FOUND: "found",
  ABSENT: "absent",
  ERROR: "error",
  UNAUTHENTICATED: "unauthenticated",
});

/**
 * @param {unknown} data — jsonb RPC
 * @param {string|null|undefined} lobbyId
 * @returns {{
 *   status: string,
 *   lobbyId: string|null,
 *   reason: string|null,
 *   closedAt: string|null,
 *   closedByUid: string|null,
 *   error?: string,
 * }}
 */
export function mapGetLobbyClosureRpcData(data, lobbyId) {
  const fallbackId =
    data && typeof data === "object" && data.lobby_id != null
      ? String(data.lobby_id)
      : lobbyId != null
        ? String(lobbyId)
        : null;

  if (data == null || typeof data !== "object") {
    return {
      status: LOBBY_CLOSURE_FETCH.ERROR,
      lobbyId: fallbackId,
      reason: null,
      closedAt: null,
      closedByUid: null,
      error: "Réponse get_lobby_closure invalide.",
    };
  }

  if (data.error === "UNAUTHENTICATED") {
    return {
      status: LOBBY_CLOSURE_FETCH.UNAUTHENTICATED,
      lobbyId: fallbackId,
      reason: null,
      closedAt: null,
      closedByUid: null,
      error: "UNAUTHENTICATED",
    };
  }

  if (data.found === true) {
    const reason =
      data.reason === LOBBY_CLOSURE_REASON.HOST_CLOSED ||
      data.reason === LOBBY_CLOSURE_REASON.INACTIVE_EXPIRED
        ? data.reason
        : null;
    return {
      status: LOBBY_CLOSURE_FETCH.FOUND,
      lobbyId: fallbackId,
      reason,
      closedAt: data.closed_at != null ? String(data.closed_at) : null,
      closedByUid:
        data.closed_by_uid != null ? String(data.closed_by_uid) : null,
    };
  }

  if (data.found === false) {
    return {
      status: LOBBY_CLOSURE_FETCH.ABSENT,
      lobbyId: fallbackId,
      reason: null,
      closedAt: null,
      closedByUid: null,
    };
  }

  return {
    status: LOBBY_CLOSURE_FETCH.ERROR,
    lobbyId: fallbackId,
    reason: null,
    closedAt: null,
    closedByUid: null,
    error: "Réponse get_lobby_closure invalide.",
  };
}
