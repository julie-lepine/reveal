/**
 * BUG-LOBBY-XX-E — état de session pour dédup / suppression modale hôte manuelle.
 */

/** @type {Set<string>} */
const handledClosureLobbyIds = new Set();

/** @type {Set<string>} lobbyIds dont l'hôte local vient de dissolve avec succès */
const localHostManualDissolveIds = new Set();

export function markLobbyClosureHandled(lobbyId) {
  if (lobbyId) handledClosureLobbyIds.add(String(lobbyId));
}

export function wasLobbyClosureHandled(lobbyId) {
  if (!lobbyId) return false;
  return handledClosureLobbyIds.has(String(lobbyId));
}

export function markLocalHostManualDissolve(lobbyId) {
  if (lobbyId) localHostManualDissolveIds.add(String(lobbyId));
}

export function isLocalHostManualDissolve(lobbyId) {
  if (!lobbyId) return false;
  return localHostManualDissolveIds.has(String(lobbyId));
}

export function clearLocalHostManualDissolve(lobbyId) {
  if (lobbyId) localHostManualDissolveIds.delete(String(lobbyId));
}

/** Tests uniquement. */
export function __resetLobbyClosureSessionStateForTests() {
  handledClosureLobbyIds.clear();
  localHostManualDissolveIds.clear();
}
