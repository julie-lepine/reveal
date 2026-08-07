/**
 * BUG-MP-JOIN-TRANSITION-01 / FEATURE-MP-JOIN-UX-01 —
 * Projection UI Home pendant la transaction join.
 *
 * Réutilise `createSyncPending().token` (joinPendingActive) déjà câblé sur Home.
 * Pas de machine à états métier dédiée : suppression du chrome membership / contrôles
 * lobby contradictoires tant que le join + hydratation + navigation ne sont pas finis.
 *
 * FEATURE-MP-JOIN-UX-01 : présentation code HERO stable (pas de rotation / timer UX).
 */

/** Copy produit stable pendant JOINING (CSS peut uppercaser). */
export const HOME_JOIN_PENDING_TITLE = "Entrée dans le lobby";

/**
 * Normalise un code lobby pour affichage HERO (uppercase, sans espaces).
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeJoinAttemptCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");
}

/**
 * @param {{
 *   joinPendingActive?: boolean,
 *   lobbyCode?: string|null,
 * }} [input]
 * @returns {{
 *   active: boolean,
 *   suppressMembershipActions: boolean,
 *   suppressLobbyControls: boolean,
 *   title: string|null,
 *   heroCode: string|null,
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
      title: null,
      heroCode: null,
      statusMessage: null,
    };
  }

  const code = normalizeJoinAttemptCode(input.lobbyCode);

  return {
    active: true,
    suppressMembershipActions: true,
    suppressLobbyControls: true,
    title: HOME_JOIN_PENDING_TITLE,
    heroCode: code || null,
    statusMessage: code
      ? `Connexion au lobby ${code} en cours`
      : "Connexion au lobby en cours",
  };
}
