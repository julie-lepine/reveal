/**
 * Membership Vague E5 - contrat dissolve_lobby_atomically (mapping pur).
 * Ne mappe jamais erreur réseau / payload inconnu → ALREADY_GONE.
 */

export const LOBBY_DISSOLVE_STATUS = Object.freeze({
  DISSOLVED: "DISSOLVED",
  ALREADY_GONE: "ALREADY_GONE",
  NOT_ALLOWED: "NOT_ALLOWED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  /** Client-only : re-query post-transport a trouvé un membership vivant ailleurs (Y ≠ X). */
  CANONICAL_ELSEWHERE: "CANONICAL_ELSEWHERE",
});

/**
 * @param {unknown} data - corps jsonb RPC (sans error transport)
 * @param {string|null|undefined} lobbyId
 * @returns {{
 *   ok: boolean,
 *   status: string|null,
 *   lobbyId?: string|null,
 *   error?: string,
 *   malformed?: boolean,
 * }}
 */
export function mapDissolveLobbyRpcData(data, lobbyId) {
  const status = data && typeof data === "object" ? data.status : null;
  const rpcLobbyId =
    data && typeof data === "object" && data.lobby_id != null
      ? data.lobby_id
      : lobbyId ?? null;

  if (status === LOBBY_DISSOLVE_STATUS.DISSOLVED) {
    return { ok: true, status, lobbyId: rpcLobbyId };
  }
  if (status === LOBBY_DISSOLVE_STATUS.ALREADY_GONE) {
    return { ok: true, status, lobbyId: rpcLobbyId };
  }
  if (status === LOBBY_DISSOLVE_STATUS.NOT_ALLOWED) {
    return {
      ok: false,
      status,
      lobbyId: rpcLobbyId,
      error: "Tu n'es pas l'hôte de ce lobby.",
    };
  }
  if (status === LOBBY_DISSOLVE_STATUS.UNAUTHENTICATED) {
    return {
      ok: false,
      status,
      lobbyId: rpcLobbyId,
      error: "Connexion requise pour fermer le lobby.",
    };
  }

  return {
    ok: false,
    status: null,
    lobbyId: rpcLobbyId,
    malformed: true,
    error: "Réponse dissolve_lobby_atomically invalide.",
  };
}

/**
 * Interprète un re-query membership après erreur transport dissolve.
 * Preuve « absent » = status none (living membership), pas SELECT lobbies seul.
 * `found` autre lobby ≠ ALREADY_GONE (ne pas Home-wipe sans hydrater Y).
 *
 * @param {{ status: string, membership?: { lobbyId?: string, role?: string, code?: string }|null }} queryResult
 * @param {string} lobbyId - lobby X qu’on tentait de dissoudre
 */
export function interpretDissolveMembershipRequery(queryResult, lobbyId) {
  const status = queryResult?.status;
  if (status === "none") {
    return {
      ok: true,
      status: LOBBY_DISSOLVE_STATUS.ALREADY_GONE,
      lobbyId,
      viaRequery: true,
    };
  }
  if (status === "found") {
    const mid = queryResult.membership?.lobbyId;
    if (mid != null && String(mid) === String(lobbyId)) {
      if (queryResult.membership?.role === "host") {
        return {
          ok: false,
          status: null,
          lobbyId,
          retryable: true,
          networkError: true,
          error:
            "La fermeture du lobby n'a pas pu être confirmée. Réessaie.",
        };
      }
      return {
        ok: false,
        status: LOBBY_DISSOLVE_STATUS.NOT_ALLOWED,
        lobbyId,
        error: "Tu n'es pas l'hôte de ce lobby.",
      };
    }
    if (mid != null) {
      return {
        ok: true,
        status: LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE,
        lobbyId,
        attemptedLobbyId: lobbyId,
        canonicalLobbyId: mid,
        canonicalCode: queryResult.membership?.code ?? null,
        viaRequery: true,
        dissolveLocalSuccess: false,
      };
    }
  }
  return {
    ok: false,
    status: null,
    lobbyId,
    unknown: true,
    networkError: true,
    error:
      "Impossible de vérifier si le lobby est encore ouvert. Réessaie dans un instant.",
  };
}
