/**
 * Bouton « 👑 Reprendre l'animation » : proposé au joueur désigné pour remplacer
 * un hôte absent (ARCH-03b). Partagé par le menu des jeux et l'écran des résultats.
 */
import { isGameSyncActive, isLobbyHost } from "./gameSync.js";
import { clientMayOfferHostClaim } from "./hostClaimOffer.js";

/** CTA distinct ARCH-03b : offre claim sans réutiliser le libellé admin. */
export function reclaimHostCtaHtml() {
  if (!isGameSyncActive() || isLobbyHost()) return "";
  if (!clientMayOfferHostClaim()) return "";
  return `
      <button type="button" class="game-select-reclaim-host" data-claim-host>
        👑 Reprendre l'animation
      </button>`;
}

/**
 * Branche les boutons « Reprendre l'animation » d'un écran.
 * @param {ParentNode} root
 * @param {{ onClaimed?: () => void }} [opts] appelé si la reprise a réussi
 */
export function bindReclaimHostButtons(root, { onClaimed } = {}) {
  root.querySelectorAll("[data-claim-host]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { ensureLobbyHostOrOfferClaim } = await import("./hostClaimOffer.js");
      const access = await ensureLobbyHostOrOfferClaim({ reason: "reclaim-cta" });
      if ((access.ok || access.claimed) && typeof onClaimed === "function") onClaimed();
    });
  });
}
