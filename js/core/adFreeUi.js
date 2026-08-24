import { isLoggedIn, isGuest } from "./auth.js";
import { isAdFree } from "./entitlements.js";

export function shouldShowAdFreePromo() {
  return !isAdFree();
}

/** Carte complète Menu → Profil (achat IAP pas encore branché). */
export function adFreeSettingsCardHtml() {
  const loggedIn = isLoggedIn();
  const guest = isGuest();
  const unlocked = isAdFree();

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
        <p class="hint settings-section__hint">Plus de bannière dans l’app native. L’achat in-app sera branché ensuite.</p>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-adfree-refresh">Actualiser le statut</button>`;
  } else {
    body = `
        <p class="hint settings-section__hint">
          2,99&nbsp;€ à vie - enlève la bannière sur tes appareils liés à ce compte.
        </p>
        <p class="hint settings-section__hint">
          L’achat Play / App Store n’est pas encore branché. En test : un flag serveur coupe déjà les pubs.
        </p>
        <button type="button" class="btn btn-primary btn--spaced" id="btn-adfree-buy" disabled>2,99&nbsp;€ - bientôt</button>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-adfree-refresh">Actualiser le statut</button>`;
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
