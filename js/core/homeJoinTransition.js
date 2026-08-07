/**
 * BUG-MP-JOIN-TRANSITION-01 — projection UI Home pendant la transaction join.
 *
 * Réutilise `createSyncPending().token` (joinPendingActive) déjà câblé sur Home.
 * Pas de machine à états métier dédiée : suppression du chrome membership / contrôles
 * lobby contradictoires tant que le join + hydratation + navigation ne sont pas finis.
 */

/**
 * @param {{
 *   joinPendingActive?: boolean,
 *   lobbyCode?: string|null,
 * }} [input]
 * @returns {{
 *   active: boolean,
 *   suppressMembershipActions: boolean,
 *   suppressLobbyControls: boolean,
 *   statusMessage: string|null,
 * }}
 */
export function deriveHomeJoinTransitionUi(input = {}) {
  const joinPendingActive = Boolean(input.joinPendingActive);
  if (!joinPendingActive) {
    return {
      active: false,
      suppressMembershipActions: false,
      suppressLobbyControls: false,
      statusMessage: null,
    };
  }

  const code = String(input.lobbyCode || "")
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");

  return {
    active: true,
    suppressMembershipActions: true,
    suppressLobbyControls: true,
    statusMessage: code
      ? `Connexion au lobby ${code}…`
      : "Connexion au lobby…",
  };
}
