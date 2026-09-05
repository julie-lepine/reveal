import { PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { isAdFree, isHostPack, isProfilePack } from "./entitlements.js";
import {
  canBuyPremiumPacks,
  includedInHostStatus,
  premiumPackCardHtml,
} from "./premiumOfferUi.js";

export function shouldShowAdFreePromo() {
  return !isAdFree();
}

const AD_FREE_FEATURES = ["Plus de bannière dans l’app native, sur tous tes appareils liés à ce compte."];

/** Carte Menu → Forfaits. */
export function adFreeSettingsCardHtml() {
  const unlocked = isAdFree();
  const canBuy = canBuyPremiumPacks();
  const includedHost = unlocked && isHostPack();
  const includedSignature = unlocked && isProfilePack() && !includedHost;

  let badge = "";
  let badgeTone = "gold";
  let price = "2,99 €";
  let priceSuffix = "à vie";
  let status = "";
  let buttonId = "";
  let buttonLabel = "";

  if (unlocked) {
    badge = includedHost || includedSignature ? "Inclus" : "Actif";
    badgeTone = includedHost || includedSignature ? "included" : "ok";
    price = "";
    priceSuffix = "";
    status = includedHost
      ? includedInHostStatus()
      : includedSignature
        ? `Sans pub est inclus dans ${PACK_SIGNATURE_LABEL}.`
        : "";
  } else if (canBuy) {
    buttonId = "btn-adfree-buy";
    buttonLabel = "Payer 2,99&nbsp;€";
  }

  return premiumPackCardHtml({
    icon: "🔇",
    title: "Sans pub",
    badge,
    badgeTone,
    price,
    priceSuffix,
    status,
    features: AD_FREE_FEATURES,
    buttonId,
    buttonLabel,
    buttonPrimary: false,
  });
}

/** Carte compacte hub jeux, sous le récap. Vide si déjà Sans pub. Le bloc entier est le CTA. */
export function adFreeHubCardHtml() {
  if (!shouldShowAdFreePromo()) return "";
  return `
      <button type="button" class="adfree-hub-card" id="btn-adfree-hub">
        <span class="adfree-hub-card__body">
          <span class="adfree-hub-card__title">Sans pub à vie - 2,99&nbsp;€</span>
          <span class="adfree-hub-card__hint">Enlève la bannière sur tes appareils liés à ce compte.</span>
        </span>
        <span class="adfree-hub-card__chevron" aria-hidden="true">›</span>
      </button>`;
}
