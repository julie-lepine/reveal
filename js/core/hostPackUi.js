import { PACK_HOST_LABEL, PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { isLoggedIn, isGuest } from "./auth.js";
import { isHostPack } from "./entitlements.js";
import { getState } from "./state.js";
import { isNativeApp } from "./platform.js";
import { hostSkuForUser, isPurchasesNativeReady } from "./purchases.js";
import {
  PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE,
  PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE,
} from "../../data/revenueCatConfig.js";

function hostPriceForUser(user) {
  const sku = hostSkuForUser(user);
  if (sku === PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE) return { amount: "3,00", euros: 3 };
  if (sku === PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE) return { amount: "7,00", euros: 7 };
  return { amount: "9,99", euros: 9.99 };
}

/** Carte Menu → Forfaits (Maître de soirée 9,99 €). */
export function hostPackSettingsCardHtml() {
  const loggedIn = isLoggedIn();
  const guest = isGuest();
  const unlocked = isHostPack();
  const storeReady = isPurchasesNativeReady();
  const user = getState().user || {};
  const { amount, euros } = hostPriceForUser(user);

  let body;
  if (guest || !loggedIn) {
    body = `
        <p class="hint settings-section__hint">
          Connecte-toi avec un compte (e-mail ou Facebook) pour activer ${PACK_HOST_LABEL} à vie - 9,99&nbsp;€.
        </p>
        <p class="hint settings-section__hint">Les invités ne peuvent pas acheter : le droit suit le compte, pas le téléphone.</p>`;
  } else if (unlocked) {
    body = `
        <p class="settings-premium__ok" role="status">${PACK_HOST_LABEL} est actif sur ce compte.</p>
        <p class="hint settings-section__hint">${PACK_SIGNATURE_LABEL} et Sans pub inclus, sur tous tes appareils liés à ce compte.</p>`;
  } else {
    const storeHint = isNativeApp()
      ? storeReady
        ? "Paiement unique."
        : "Achats pas encore disponibles sur cette plateforme."
      : "L’achat se fait dans l’app native, pas sur le navigateur.";
    let priceHint = `9,99&nbsp;€ à vie - ${PACK_HOST_LABEL} + ${PACK_SIGNATURE_LABEL} + Sans pub, sur tes appareils liés à ce compte.`;
    if (euros === 3) {
      priceHint = `3,00&nbsp;€ de plus - tu as déjà ${PACK_SIGNATURE_LABEL}. ${PACK_HOST_LABEL} à vie, Signature et pubs inclus.`;
    } else if (euros === 7) {
      priceHint = `7,00&nbsp;€ de plus - tu as déjà Sans pub. ${PACK_HOST_LABEL} à vie, ${PACK_SIGNATURE_LABEL} et pubs inclus.`;
    }
    body = `
        <p class="hint settings-section__hint">${priceHint}</p>
        <p class="hint settings-section__hint">${storeHint}</p>
        <button type="button" class="btn btn-primary btn--spaced" id="btn-host-buy">Payer ${amount}&nbsp;€</button>`;
  }

  return `
      <div class="card settings-section settings-premium">
        <h2 class="settings-section__title">${PACK_HOST_LABEL}</h2>
        ${body}
      </div>`;
}
