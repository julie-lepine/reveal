/**
 * BUG-LOBBY-XX-E - copies produit pour fermeture de lobby (raison serveur).
 * Ne jamais attribuer à l'hôte sans reason === host_closed.
 */

export const LOBBY_CLOSURE_REASON = Object.freeze({
  HOST_CLOSED: "host_closed",
  INACTIVE_EXPIRED: "inactive_expired",
});

/**
 * @param {string|null|undefined} reason
 * @returns {{ title: string, message: string, cta: string, icon: string }}
 */
export function getLobbyClosureCopy(reason) {
  switch (reason) {
    case LOBBY_CLOSURE_REASON.HOST_CLOSED:
      return {
        title: "Lobby fermé",
        message: "L'hôte a fermé le lobby.",
        cta: "Retour à l'accueil",
        icon: "👋",
      };
    case LOBBY_CLOSURE_REASON.INACTIVE_EXPIRED:
      return {
        title: "Lobby fermé automatiquement",
        message: "Ce lobby a été fermé après une période d'inactivité.",
        cta: "Retour à l'accueil",
        icon: "⌛",
      };
    default:
      return {
        title: "Lobby fermé",
        message: "Le lobby a été fermé.",
        cta: "Retour à l'accueil",
        icon: "👋",
      };
  }
}
