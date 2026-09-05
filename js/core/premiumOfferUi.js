import { PACK_HOST_LABEL } from "../config/premiumPacks.js";
import { isLoggedIn, isGuest } from "./auth.js";
import { isNativeApp } from "./platform.js";
import { isPurchasesNativeReady } from "./purchases.js";
import { escapeHtml } from "./ui.js";

export const PREMIUM_OFFER_HOOK = "Un paiement. Tes soirées, à vie.";

export function canBuyPremiumPacks() {
  return isLoggedIn() && !isGuest();
}

export function premiumOfferStoreHint() {
  if (isNativeApp()) {
    return isPurchasesNativeReady()
      ? "Paiement unique. Tes achats suivent ce compte, sur tous tes appareils."
      : "Achats pas encore disponibles sur cette plateforme.";
  }
  return "L’achat se fait dans l’app native, pas sur le navigateur.";
}

export function premiumFeatureListHtml(items) {
  return `<ul class="premium-offer__feats">${items
    .map((item) => `<li class="premium-offer__feat">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}

export function premiumOfferChromeHtml() {
  const loginHint = canBuyPremiumPacks()
    ? ""
    : `<p class="hint premium-offer__login">Connecte-toi avec un compte (e-mail ou Facebook) pour acheter. Le droit suit le compte, pas le téléphone.</p>`;
  return `
      <div class="premium-offer__intro">
        <p class="premium-offer__hook">${escapeHtml(PREMIUM_OFFER_HOOK)}</p>
        ${loginHint}
      </div>`;
}

export function premiumOfferFooterHintHtml() {
  return `<p class="hint premium-offer__store">${escapeHtml(premiumOfferStoreHint())}</p>`;
}

function badgeClass(tone) {
  if (tone === "ok") return " premium-offer__badge--ok";
  if (tone === "included") return " premium-offer__badge--included";
  return "";
}

/**
 * Carte forfait. `buttonLabel` est du HTML contrôlé (ex. &nbsp;).
 */
export function premiumPackCardHtml({
  hero = false,
  icon = "",
  title,
  badge = "",
  badgeTone = "gold",
  price = "",
  priceSuffix = "",
  priceNote = "",
  status = "",
  features = [],
  buttonId = "",
  buttonLabel = "",
  buttonPrimary = false,
}) {
  const cls = hero ? "premium-offer premium-offer--hero" : "premium-offer premium-offer--side";
  const badgeHtml = badge
    ? `<span class="premium-offer__badge${badgeClass(badgeTone)}">${escapeHtml(badge)}</span>`
    : "";
  const priceHtml = price
    ? `<p class="premium-offer__price">
        <span class="premium-offer__amount">${escapeHtml(price)}</span>
        ${priceSuffix ? `<span class="premium-offer__life">${escapeHtml(priceSuffix)}</span>` : ""}
      </p>`
    : "";
  const noteHtml = priceNote ? `<p class="hint premium-offer__note">${escapeHtml(priceNote)}</p>` : "";
  const statusHtml = status
    ? `<p class="settings-premium__ok" role="status">${escapeHtml(status)}</p>`
    : "";
  const btnHtml =
    buttonId && buttonLabel
      ? `<button type="button" class="btn ${
          buttonPrimary ? "btn-primary" : "btn-secondary"
        } btn--spaced" id="${escapeHtml(buttonId)}">${buttonLabel}</button>`
      : "";

  return `
      <div class="card settings-section settings-premium ${cls}">
        <div class="premium-offer__top">
          ${icon ? `<span class="premium-offer__icon" aria-hidden="true">${icon}</span>` : ""}
          <div class="premium-offer__heading">
            <h2 class="settings-section__title premium-offer__title">${escapeHtml(title)}</h2>
            ${badgeHtml}
          </div>
        </div>
        ${priceHtml}
        ${statusHtml}
        ${noteHtml}
        ${premiumFeatureListHtml(features)}
        ${btnHtml}
      </div>`;
}

export function includedInHostStatus() {
  return `Inclus dans ${PACK_HOST_LABEL}.`;
}
