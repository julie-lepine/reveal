/**
 * Vague D — quitter / fermer un lobby depuis une membership server-only.
 *
 * Identité canonique : snapshot.membership.{lobbyId,code,role} — pas state.lobby.
 * Pipeline séparé du leave cache-actif (leaveLobby / dissolveLobbyAsHost).
 *
 * Après mutation réussie : re-query obligatoire ; Créer uniquement si `none` confirmé.
 *
 * Concurrence documentée : DELETE OK → autre membership créée avant confirmation
 * → query `found` (pas `none`) — correct.
 */

import { LOBBY_DISSOLVE_STATUS } from "./lobbyDissolveContract.js";

export const LOBBY_SERVER_LEAVE_ERROR = Object.freeze({
  INVALID_MEMBERSHIP: "LOBBY_SERVER_LEAVE_INVALID_MEMBERSHIP",
  AUTH_REQUIRED: "LOBBY_SERVER_LEAVE_AUTH_REQUIRED",
  FAILED: "LOBBY_SERVER_LEAVE_FAILED",
  DISSOLVE_FAILED: "LOBBY_SERVER_DISSOLVE_FAILED",
  ROLE_MISMATCH: "LOBBY_SERVER_ROLE_MISMATCH",
  CACHE_ACTIVE: "LOBBY_SERVER_LEAVE_CACHE_ACTIVE",
  INVALID_ROLE: "LOBBY_SERVER_LEAVE_INVALID_ROLE",
});

/**
 * @param {string} code
 * @param {string} message
 * @param {object} [extras]
 */
export function makeLobbyServerLeaveError(code, message, extras = {}) {
  const err = new Error(message);
  err.name = "LobbyServerLeaveError";
  err.code = code;
  Object.assign(err, extras);
  return err;
}

/** Libellé bouton Home selon le rôle snapshot. */
export function leaveServerActionLabel(role) {
  return role === "host" ? "Fermer le lobby" : "Quitter le lobby";
}

export const SERVER_LEAVE_CONFIRM = Object.freeze({
  member: Object.freeze({
    title: "Quitter ce lobby ?",
    message:
      "Tu devras le rejoindre à nouveau avec son code pour y revenir.",
    confirmLabel: "Quitter le lobby",
    cancelLabel: "Annuler",
    icon: "🚪",
  }),
  host: Object.freeze({
    title: "Fermer ce lobby ?",
    message: "Le lobby sera fermé pour tous les participants.",
    confirmLabel: "Fermer le lobby",
    cancelLabel: "Annuler",
    icon: "🚪",
  }),
});

/**
 * Validation d’entrée (pure) — avant toute mutation.
 * @returns {{ ok: true } | { ok: false, error: Error }}
 */
export function validateServerLeaveInput({
  lobbyId,
  role,
  userId,
  hasActiveLobby = false,
} = {}) {
  if (hasActiveLobby) {
    return {
      ok: false,
      error: makeLobbyServerLeaveError(
        LOBBY_SERVER_LEAVE_ERROR.CACHE_ACTIVE,
        "Un lobby hydraté est déjà actif. Utilise Quitter depuis le cache local."
      ),
    };
  }
  if (!userId) {
    return {
      ok: false,
      error: makeLobbyServerLeaveError(
        LOBBY_SERVER_LEAVE_ERROR.AUTH_REQUIRED,
        "Connexion requise pour quitter ce lobby."
      ),
    };
  }
  const id = typeof lobbyId === "string" ? lobbyId.trim() : "";
  if (!id) {
    return {
      ok: false,
      error: makeLobbyServerLeaveError(
        LOBBY_SERVER_LEAVE_ERROR.INVALID_MEMBERSHIP,
        "Membership serveur invalide (lobbyId manquant)."
      ),
    };
  }
  if (role !== "host" && role !== "member") {
    return {
      ok: false,
      error: makeLobbyServerLeaveError(
        LOBBY_SERVER_LEAVE_ERROR.INVALID_ROLE,
        "Rôle membership invalide."
      ),
    };
  }
  return { ok: true };
}

/**
 * Compare intention UI (snapshot) vs host_id serveur.
 * Lobby absent (hostId null) : leave membre encore tentable ; dissolve → mismatch.
 *
 * @returns {{ ok: true, action: "left"|"dissolved" } | { ok: false, error: Error }}
 */
export function resolveServerLeaveAction({
  intendedRole,
  serverHostId,
  userId,
} = {}) {
  const isServerHost =
    Boolean(userId) &&
    serverHostId != null &&
    String(serverHostId) === String(userId);

  if (intendedRole === "host") {
    if (!isServerHost) {
      return {
        ok: false,
        error: makeLobbyServerLeaveError(
          LOBBY_SERVER_LEAVE_ERROR.ROLE_MISMATCH,
          "Tu n'es plus l'hôte de ce lobby. Actualisation nécessaire.",
          { intendedRole, serverHostId: serverHostId ?? null }
        ),
      };
    }
    return { ok: true, action: "dissolved" };
  }

  if (intendedRole === "member") {
    if (isServerHost) {
      return {
        ok: false,
        error: makeLobbyServerLeaveError(
          LOBBY_SERVER_LEAVE_ERROR.ROLE_MISMATCH,
          "Tu es hôte sur le serveur — utilise Fermer le lobby.",
          { intendedRole, serverHostId }
        ),
      };
    }
    return { ok: true, action: "left" };
  }

  return {
    ok: false,
    error: makeLobbyServerLeaveError(
      LOBBY_SERVER_LEAVE_ERROR.INVALID_ROLE,
      "Rôle membership invalide."
    ),
  };
}

/**
 * Mutation server-only (injectable).
 *
 * @param {{
 *   lobbyId: string,
 *   code?: string|null,
 *   role: "host"|"member",
 *   hasActiveLobby?: boolean,
 * }} input
 * @param {{
 *   getUserId: () => string|null|undefined,
 *   fetchLobbyHostId: (lobbyId: string) => Promise<string|null>,
 *   deleteOwnMembership: (lobbyId: string) => Promise<{ ok: boolean, error?: string }>,
 *   closeLobbyAsHost: (lobbyId: string) => Promise<{ ok: boolean, error?: string }>,
 * }} deps
 * @returns {Promise<{ ok: true, action: "left"|"dissolved", lobbyId: string, code?: string|null }>}
 */
export async function leaveLobbyMembershipFromServer(input, deps) {
  const lobbyId = typeof input?.lobbyId === "string" ? input.lobbyId.trim() : "";
  const role = input?.role;
  const code = input?.code ?? null;
  const userId = deps.getUserId?.() || null;

  const validated = validateServerLeaveInput({
    lobbyId,
    role,
    userId,
    hasActiveLobby: Boolean(input?.hasActiveLobby),
  });
  if (!validated.ok) throw validated.error;

  let serverHostId;
  try {
    serverHostId = await deps.fetchLobbyHostId(lobbyId);
  } catch (err) {
    throw makeLobbyServerLeaveError(
      LOBBY_SERVER_LEAVE_ERROR.FAILED,
      err?.message || "Impossible de vérifier le lobby sur le serveur.",
      { cause: err }
    );
  }

  const resolved = resolveServerLeaveAction({
    intendedRole: role,
    serverHostId,
    userId,
  });
  if (!resolved.ok) throw resolved.error;

  if (resolved.action === "dissolved") {
    const res = await deps.closeLobbyAsHost(lobbyId);
    if (res?.status === LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE) {
      return {
        ok: true,
        action: "canonical_elsewhere",
        lobbyId,
        code,
        status: LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE,
        canonicalLobbyId: res.canonicalLobbyId ?? null,
      };
    }
    if (!res?.ok) {
      throw makeLobbyServerLeaveError(
        LOBBY_SERVER_LEAVE_ERROR.DISSOLVE_FAILED,
        res?.error || "Impossible de fermer le lobby.",
        { lobbyId }
      );
    }
    return { ok: true, action: "dissolved", lobbyId, code };
  }

  const res = await deps.deleteOwnMembership(lobbyId);
  if (!res?.ok) {
    throw makeLobbyServerLeaveError(
      LOBBY_SERVER_LEAVE_ERROR.FAILED,
      res?.error || "Impossible de quitter le lobby.",
      { lobbyId }
    );
  }
  return { ok: true, action: "left", lobbyId, code };
}
