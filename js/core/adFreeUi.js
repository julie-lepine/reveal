import { isLoggedIn, isGuest } from "./auth.js";
import { isAdFree } from "./entitlements.js";
import { isNativeApp } from "./platform.js";
import { isPurchasesNativeReady } from "./purchases.js";

export function shouldShowAdFreePromo() {
  return !isAdFree();
}

/** Carte Menu → Profil. */
export function adFreeSettingsCardHtml() {
  const loggedIn = isLoggedIn();
  const guest = isGuest();
  const unlocked = isAdFree();
  const storeReady = isPurchasesNativeReady();

  let body;
  if (guest || !loggedIn) {
    body = `
        <p class="hint settings-section__hint">
          Connecte-toi avec un compte (e-mail ou Facebook) pour activer Sans pub à vie - 2,99&nbsp;€.
        </p>
        <p class="hint settings-section__hint">Les invités ne peuvent pas acheter : le droit suit le compte, pas le téléphone.</p>`;
  } else if (unlocked) {
    body = `
        <p class="settings-premium__ok" role="status">Sans pub est actif sur ce compte.</p>
        <p class="hint settings-section__hint">Plus de bannière dans l’app native, sur tous tes appareils liés à ce compte.</p>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-adfree-restore">Restaurer l’achat</button>`;
  } else {
    const storeHint = isNativeApp()
      ? storeReady
        ? "Paiement unique."
        : "Achats pas encore disponibles sur cette plateforme."
      : "L’achat se fait dans l’app Android (Play Store), pas sur le navigateur.";
    body = `
        <p class="hint settings-section__hint">
          2,99&nbsp;€ à vie - supprime la pub sur tes appareils liés à ce compte.
        </p>
        <p class="hint settings-section__hint">${storeHint}</p>
        <button type="button" class="btn btn-primary btn--spaced" id="btn-adfree-buy">Payer 2,99&nbsp;€</button>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-adfree-restore">Restaurer l’achat</button>`;
  }

  return `
      <div class="card settings-section settings-premium">
        <h2 class="settings-section__title">Sans pub</h2>
        ${body}
      </div>`;
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
