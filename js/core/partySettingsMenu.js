/**
 * Actions de la section « Partie en cours » selon le rôle (écran settings).
 * Module pur - pas de DOM.
 *
 * `players` : inscrits (hôte + membres). Kick reste hôte-only dans le dialog.
 * Invité anonyme : leave seulement.
 */

/**
 * @param {"host"|"member"|string} role
 * @param {{ localIsRegistered?: boolean }} [opts]
 * @returns {readonly string[]}
 */
export function lobbySettingsActionsForRole(role, { localIsRegistered = false } = {}) {
  if (role === "host") {
    return Object.freeze(["transfer", "players", "close"]);
  }
  if (localIsRegistered) {
    return Object.freeze(["players", "leave"]);
  }
  return Object.freeze(["leave"]);
}
