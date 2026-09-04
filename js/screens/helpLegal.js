/**
 * Aide, dépannage, légal, suppression de compte.
 * Entrée : Menu → Profil, au-dessus de Déconnexion.
 */
import { HELP_LEGAL_LABEL } from "../config/helpLegal.js";
import { INSTAGRAM_HANDLE, INSTAGRAM_PROFILE_URL } from "../../data/appConfig.js";
import { canPlay, deleteRegisteredAccount, isLoggedIn } from "../core/auth.js";
import { showAppAlert, showAppConfirm } from "../core/dialog.js";
import { openInstagramProfile } from "../core/feedbackUi.js";
import { resetAppToCleanHome } from "../core/lobby.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

function helpLegalBodyHtml(registeredAccount) {
  const deletionBlock = registeredAccount
    ? `
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-delete-account">Supprimer mon compte</button>
        <p class="hint settings-section__hint">
          Suppression définitive, immédiate, dans l'application. Irréversible.
        </p>`
    : `
        <p class="hint settings-section__hint">
          Le mode invité ne crée pas de compte. Tes données de session expirent toutes seules.
        </p>`;

  return `
      <div class="card settings-section feedback-prompt">
        <h2 class="settings-section__title">Aide &amp; retours</h2>
        <p class="hint feedback-prompt__hint">
          Un bug, une idée de jeu ou un mot à ajouter ? Écris-nous sur Instagram
          <strong>@${escapeHtml(INSTAGRAM_HANDLE)}</strong>.
        </p>
        <button type="button" class="btn btn-accent feedback-prompt__btn btn--spaced" id="btn-feedback-dm">Envoie un DM</button>
      </div>

      <div class="card settings-section">
        <h2 class="settings-section__title">Dépannage</h2>
        <p class="hint settings-section__hint">
          Affichage bloqué ou session coincée ? Efface les données locales et recharge l'app.
        </p>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-settings-reset-app">Problème d'affichage ? Réinitialiser l'app</button>
      </div>

      <div class="card settings-section">
        <h2 class="settings-section__title">Légal</h2>
        <p class="hint settings-section__hint">Politique de confidentialité (RGPD, AdMob, Supabase).</p>
        <p class="hint settings-section__hint">
          Contact RGPD :
        <a
          class="settings-instagram-link"
          href="${escapeHtml(INSTAGRAM_PROFILE_URL)}"
          target="_blank"
          rel="noopener noreferrer"
          data-open-instagram
        >@${escapeHtml(INSTAGRAM_HANDLE)}</a>
        </p>
        <button type="button" class="btn btn-secondary btn--spaced" data-nav="privacy">Politique de confidentialité</button>
        ${deletionBlock}
      </div>`;
}

export function mountHelpLegal(app) {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return null;
  }

  const mount = createMountGuard();
  const registeredAccount = isLoggedIn();

  app.innerHTML = pageShell({
    back: true,
    backTarget: "back",
    scroll: true,
    content: `
      <p class="label-upper label-upper--muted">Menu</p>
      <h1 class="page-title">${escapeHtml(HELP_LEGAL_LABEL)}</h1>
      ${helpLegalBodyHtml(registeredAccount)}
    `,
  });

  bindNav(app);

  app.querySelector("#btn-feedback-dm")?.addEventListener("click", () => {
    openInstagramProfile();
  });

  app.querySelector("#btn-settings-reset-app")?.addEventListener("click", async () => {
    const ok = await showAppConfirm(
      "Ta session et les données locales seront effacées. Tu pourras rejoindre une partie à nouveau.",
      {
        title: "Réinitialiser REVEAL",
        confirmLabel: "Réinitialiser",
        cancelLabel: "Annuler",
        icon: "🔄",
      }
    );
    if (!mount.isMounted()) return;
    if (!ok) return;
    await resetAppToCleanHome();
  });

  app.querySelector("#btn-delete-account")?.addEventListener("click", async () => {
    if (!mount.isMounted()) return;
    const btn = app.querySelector("#btn-delete-account");
    if (btn?.disabled) return;

    const ok = await showAppConfirm(
      "Ton compte et tes données personnelles (profil, amis, invitations) seront définitivement supprimés. Cette action est irréversible. L'achat Sans pub reste lié à ton compte Apple ou Google : tu pourras le restaurer plus tard.",
      {
        title: "Supprimer mon compte",
        confirmLabel: "Supprimer définitivement",
        cancelLabel: "Annuler",
        icon: "⚠️",
      }
    );
    if (!mount.isMounted() || !ok) return;

    if (btn) btn.disabled = true;
    const res = await deleteRegisteredAccount();
    if (!mount.isMounted()) return;
    if (res?.cancelled) {
      if (btn) btn.disabled = false;
      return;
    }
    if (res?.ok === false) {
      if (btn) btn.disabled = false;
      await showAppAlert(res.error || "Impossible de supprimer le compte.", {
        title: "Suppression",
        icon: "⚠️",
      });
      return;
    }
    await showAppAlert("Ton compte a été supprimé.", {
      title: "Compte supprimé",
      icon: "✅",
    });
    navigate("home", { reset: true });
  });

  app.querySelector("[data-open-instagram]")?.addEventListener("click", (e) => {
    e.preventDefault();
    openInstagramProfile();
  });

  return () => {
    mount.dispose();
  };
}
