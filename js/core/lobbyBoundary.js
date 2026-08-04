/**
 * Contrats de frontière lobby - session cache, restore, lastGame scope.
 * Purs / testables sans Supabase.
 */

/** @typedef {{ status: "found", row: object } | { status: "none" } | { status: "error", error?: unknown }} SessionRestoreOutcome */
/** @typedef {{ status: "found", row: object } | { status: "none" } | { status: "error" }} SessionRestoreAttempt */

/**
 * Clé de scope pour lastGame (id Supabase, instance offline unique, ou code legacy).
 * @param {{ id?: string|null, localInstanceId?: string|null, code?: string|null }|null|undefined} lobby
 * @param {string|null|undefined} lobbyCode
 */
export function getLastGameScopeKey(lobby, lobbyCode = null) {
  if (lobby?.id) return lobby.id;
  if (lobby?.localInstanceId) return lobby.localInstanceId;
  return lobby?.code || lobbyCode || null;
}

/** Identifiant unique pour une soirée offline (réutilisation de code possible). */
export function newOfflineLobbyInstanceId() {
  return `offline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * lastGame est une donnée de soirée rattachée au lobby courant.
 * @param {{ scopeKey?: string|null }|null|undefined} lastGame
 * @param {string|null|undefined} scopeKey
 */
export function isLastGameInCurrentScope(lastGame, scopeKey) {
  if (!lastGame) return false;
  if (!scopeKey) return false;
  if (!lastGame.scopeKey) return false;
  return lastGame.scopeKey === scopeKey;
}

/**
 * Une game_session appartient au lobby indiqué.
 * @param {{ lobby_id?: string|null }|null|undefined} row
 * @param {string|null|undefined} lobbyId
 */
export function isSessionRowForLobby(row, lobbyId) {
  if (!row) return false;
  if (!lobbyId) return false;
  return row.lobby_id === lobbyId;
}

/**
 * Le cache mémoire n'est exploitable que pour le lobby actif.
 * @param {{ lobby_id?: string|null }|null|undefined} cachedRow
 * @param {string|null|undefined} currentLobbyId
 */
export function shouldExposeCachedSession(cachedRow, currentLobbyId) {
  if (!cachedRow) return false;
  if (!currentLobbyId) return false;
  return cachedRow.lobby_id === currentLobbyId;
}

/**
 * Peut-on appliquer une session distante (y compris null = absence confirmée) ?
 * @param {{ lobby_id?: string|null }|null|undefined} row
 * @param {string|null|undefined} currentLobbyId
 * @param {{ lobby_id?: string|null }|null|undefined} [cachedRow]
 */
export function canApplyRemoteSessionRow(row, currentLobbyId, cachedRow = null) {
  if (row) {
    if (!currentLobbyId) return false;
    return row.lobby_id === currentLobbyId;
  }
  if (!cachedRow) return true;
  if (!currentLobbyId) return false;
  return cachedRow.lobby_id === currentLobbyId;
}

/**
 * Le cache doit-il être vidé car il appartient à un autre lobby ?
 * @param {{ lobby_id?: string|null }|null|undefined} cachedRow
 * @param {string|null|undefined} targetLobbyId
 */
export function shouldClearCachedSessionForLobbyBoundary(cachedRow, targetLobbyId) {
  if (!cachedRow) return false;
  if (!targetLobbyId) return true;
  return cachedRow.lobby_id !== targetLobbyId;
}

/**
 * Agrège les tentatives de restore (found > none > error indéterminé).
 * @param {SessionRestoreAttempt[]} attempts
 * @returns {SessionRestoreOutcome}
 */
export function resolveSessionRestoreOutcome(attempts) {
  if (!attempts?.length) return { status: "error" };

  let foundRow = null;
  let sawConfirmedNone = false;
  let sawNonError = false;

  for (const attempt of attempts) {
    if (attempt.status === "found") {
      foundRow = attempt.row;
      sawNonError = true;
    } else if (attempt.status === "none") {
      sawConfirmedNone = true;
      sawNonError = true;
    }
  }

  if (foundRow) return { status: "found", row: foundRow };
  if (sawConfirmedNone) return { status: "none" };
  if (!sawNonError) return { status: "error" };
  return { status: "error" };
}
