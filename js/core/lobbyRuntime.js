/**
 * Génération runtime lobby — invalide les callbacks async démarrés sous une génération antérieure.
 * Purs / testables sans DOM.
 */

let lobbyRuntimeGeneration = 0;

/** @typedef {{ generation: number, lobbyId: string|null }} LobbyRuntimeEpoch */

export function getLobbyRuntimeGeneration() {
  return lobbyRuntimeGeneration;
}

/** Invalide les opérations async en cours (transition, commit, rollback). */
export function bumpLobbyRuntimeGeneration() {
  lobbyRuntimeGeneration += 1;
  return lobbyRuntimeGeneration;
}

/** @returns {LobbyRuntimeEpoch} */
export function captureLobbyRuntimeEpoch(lobbyId = null) {
  return {
    generation: lobbyRuntimeGeneration,
    lobbyId,
  };
}

/** @param {LobbyRuntimeEpoch|null|undefined} epoch */
export function isLobbyRuntimeEpochCurrent(epoch) {
  if (!epoch) return true;
  return epoch.generation === lobbyRuntimeGeneration;
}

/**
 * @param {LobbyRuntimeEpoch|null|undefined} epoch
 * @param {string|null|undefined} rowLobbyId
 * @param {string|null|undefined} currentLobbyId
 */
export function shouldApplyLobbyRuntimeResult(epoch, rowLobbyId, currentLobbyId) {
  if (!isLobbyRuntimeEpochCurrent(epoch)) return false;
  if (rowLobbyId && currentLobbyId && rowLobbyId !== currentLobbyId) return false;
  return true;
}

/** Tests uniquement. */
export function __resetLobbyRuntimeGenerationForTests() {
  lobbyRuntimeGeneration = 0;
}
