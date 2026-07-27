/**
 * UX-NAV-LOBBY — actions du menu Paramètres de partie selon le rôle.
 * Module pur (pas de DOM) pour partage dialog / tests.
 */

/**
 * @param {"host"|"member"|string} role
 * @returns {readonly string[]}
 */
export function partySettingsActionsForRole(role) {
  if (role === "host") {
    return Object.freeze(["transfer", "players", "close"]);
  }
  return Object.freeze(["leave"]);
}
