/**
 * Actions de la section « Partie en cours » selon le rôle (écran settings).
 * Module pur — pas de DOM.
 */

/**
 * @param {"host"|"member"|string} role
 * @returns {readonly string[]}
 */
export function lobbySettingsActionsForRole(role) {
  if (role === "host") {
    return Object.freeze(["transfer", "players", "close"]);
  }
  return Object.freeze(["leave"]);
}

/** @deprecated alias — préférer lobbySettingsActionsForRole */
export const partySettingsActionsForRole = lobbySettingsActionsForRole;
