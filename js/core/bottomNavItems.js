/**
 * UX-NAV-LOBBY - catalogue des onglets du menu principal.
 * Visibilité fondée sur l’appartenance lobby (`hasActiveLobby`), pas sur l’écran courant.
 */

export const BOTTOM_NAV_TAB = Object.freeze({
  HOME: "home",
  SETTINGS: "settings",
  GAMES: "games",
  LOGO: "logo",
  RESULTS: "results",
  FINAL: "final",
});

/**
 * @param {boolean} inLobby
 * @returns {readonly string[]}
 */
export function resolveBottomNavTabs(inLobby) {
  if (inLobby) {
    return Object.freeze([
      BOTTOM_NAV_TAB.GAMES,
      BOTTOM_NAV_TAB.RESULTS,
      BOTTOM_NAV_TAB.LOGO,
      BOTTOM_NAV_TAB.FINAL,
      BOTTOM_NAV_TAB.SETTINGS,
    ]);
  }
  return Object.freeze([
    BOTTOM_NAV_TAB.GAMES,
    BOTTOM_NAV_TAB.RESULTS,
    BOTTOM_NAV_TAB.LOGO,
    BOTTOM_NAV_TAB.FINAL,
    BOTTOM_NAV_TAB.HOME,
  ]);
}

/**
 * @param {boolean} inLobby
 * @param {string} tabId
 */
export function isBottomNavTabVisible(inLobby, tabId) {
  return resolveBottomNavTabs(inLobby).includes(tabId);
}
