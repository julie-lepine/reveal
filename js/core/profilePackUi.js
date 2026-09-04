import { isLoggedIn, isGuest } from "./auth.js";
import { isProfilePack } from "./entitlements.js";
import { getState } from "./state.js";
import { isNativeApp } from "./platform.js";
import { isPurchasesNativeReady, profileSkuForUser } from "./purchases.js";
import { PLAY_PRODUCT_ID_PROFILE_UPGRADE } from "../../data/revenueCatConfig.js";

/** Carte Menu → Profil (pack 6,99 €). */
export function profilePackSettingsCardHtml() {
  const loggedIn = isLoggedIn();
  const guest = isGuest();
  const unlocked = isProfilePack();
  const storeReady = isPurchasesNativeReady();
  const user = getState().user || {};
  const upgrade = profileSkuForUser(user) === PLAY_PRODUCT_ID_PROFILE_UPGRADE;
  const priceLabel = upgrade ? "4,00" : "6,99";

  let body;
  if (guest || !loggedIn) {
    body = `
        <p class="hint settings-section__hint">
          Connecte-toi avec un compte (e-mail ou Facebook) pour activer Profil à vie - 6,99&nbsp;€.
        </p>
        <p class="hint settings-section__hint">Les invités ne peuvent pas acheter : le droit suit le compte, pas le téléphone.</p>`;
  } else if (unlocked) {
    body = `
        <p class="settings-premium__ok" role="status">Profil est actif sur ce compte.</p>
        <p class="hint settings-section__hint">Sans pub inclus, sur tous tes appareils liés à ce compte.</p>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-profile-restore">Restaurer l’achat</button>`;
  } else {
    const storeHint = isNativeApp()
      ? storeReady
        ? "Paiement unique."
        : "Achats pas encore disponibles sur cette plateforme."
      : "L’achat se fait dans l’app native, pas sur le navigateur.";
    const priceHint = upgrade
      ? "4,00&nbsp;€ de plus - tu as déjà Sans pub. Profil à vie, pubs incluses."
      : "6,99&nbsp;€ à vie - Profil + Sans pub, sur tes appareils liés à ce compte.";
    body = `
        <p class="hint settings-section__hint">${priceHint}</p>
        <p class="hint settings-section__hint">${storeHint}</p>
        <button type="button" class="btn btn-primary btn--spaced" id="btn-profile-buy">Payer ${priceLabel}&nbsp;€</button>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-profile-restore">Restaurer l’achat</button>`;
  }

  return `
      <div class="card settings-section settings-premium">
        <h2 class="settings-section__title">Profil</h2>
        ${body}
      </div>`;
}
