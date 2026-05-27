import { changeEmailPassword } from "../core/auth.js";
import { isSupabaseConfigured } from "../core/supabaseClient.js";
import { supabase } from "../core/supabaseClient.js";
import {
  clearPasswordRecoveryPending,
  isPasswordRecoveryPending,
} from "../core/supabaseAuth.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { showAppAlert } from "../core/dialog.js";
import { bindNav } from "./nav.js";

function bindPasswordToggle(app, btn) {
  const inputId = btn.getAttribute("data-toggle-password");
  const input = inputId ? app.querySelector(`#${CSS.escape(inputId)}`) : null;
  if (!input) return;
  const shown = input.type === "text";
  input.type = shown ? "password" : "text";
  const nextShown = input.type === "text";
  btn.setAttribute("aria-pressed", nextShown ? "true" : "false");
  btn.setAttribute("aria-label", nextShown ? "Masquer le mot de passe" : "Afficher le mot de passe");
  btn.textContent = nextShown ? "🙈" : "👁️";
}

export function mountResetPassword(app) {
  if (!isSupabaseConfigured()) {
    navigate("home", { reset: true });
    return null;
  }

  let hasSession = false;

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    hasSession = Boolean(data?.session?.user && !data.session.user.is_anonymous);
    return hasSession;
  }

  function render(expired = false) {
    app.innerHTML = pageShell({
      back: true,
      content: expired
        ? `
        <p class="label-upper">Mot de passe</p>
        <h1 class="page-title">Lien expiré</h1>
        <div class="card">
          <p class="hint">Ce lien de réinitialisation n'est plus valide. Demande un nouvel email depuis l'écran de connexion.</p>
          <button type="button" class="btn btn-primary btn--spaced" id="btn-reset-go-home">Retour à l'accueil</button>
        </div>`
        : `
        <p class="label-upper">Mot de passe</p>
        <h1 class="page-title">Nouveau mot de passe</h1>
        <div class="card auth-form">
          <p class="hint auth-form__guest-intro">Choisis un nouveau mot de passe pour ton compte REVEAL.</p>
          <label class="field-label" for="reset-pwd-new">Nouveau mot de passe</label>
          <div class="password-field">
            <input type="password" class="field-input password-field__input" id="reset-pwd-new" autocomplete="new-password" placeholder="4 caractères min." />
            <button type="button" class="password-field__toggle" data-toggle-password="reset-pwd-new" aria-label="Afficher le mot de passe" aria-pressed="false">👁️</button>
          </div>
          <label class="field-label" for="reset-pwd-confirm">Confirmer</label>
          <div class="password-field">
            <input type="password" class="field-input password-field__input" id="reset-pwd-confirm" autocomplete="new-password" />
            <button type="button" class="password-field__toggle" data-toggle-password="reset-pwd-confirm" aria-label="Afficher le mot de passe" aria-pressed="false">👁️</button>
          </div>
          <p class="auth-error hidden" id="reset-pwd-error"></p>
          <button type="button" class="btn btn-primary btn--spaced" id="btn-reset-save">Enregistrer</button>
        </div>`,
    });

    bindNav(app, {
      back: () => {
        clearPasswordRecoveryPending();
        navigate("home", { reset: true });
      },
    });

    app.querySelector("#btn-reset-go-home")?.addEventListener("click", () => {
      clearPasswordRecoveryPending();
      navigate("home", { reset: true });
    });

    app.querySelectorAll("[data-toggle-password]").forEach((btn) => {
      btn.addEventListener("click", () => bindPasswordToggle(app, btn));
    });

    app.querySelector("#btn-reset-save")?.addEventListener("click", async () => {
      const err = app.querySelector("#reset-pwd-error");
      const btn = app.querySelector("#btn-reset-save");
      const next = app.querySelector("#reset-pwd-new")?.value || "";
      const confirm = app.querySelector("#reset-pwd-confirm")?.value || "";

      err?.classList.add("hidden");

      if (next.length < 4) {
        err.textContent = "Le mot de passe doit faire au moins 4 caractères.";
        err.classList.remove("hidden");
        return;
      }
      if (next !== confirm) {
        err.textContent = "Les deux mots de passe ne correspondent pas.";
        err.classList.remove("hidden");
        return;
      }

      btn.disabled = true;
      const res = await changeEmailPassword("", next);
      btn.disabled = false;

      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }

      clearPasswordRecoveryPending();
      await showAppAlert("Ton mot de passe a été mis à jour. Tu peux te connecter avec ton nouveau mot de passe.", {
        title: "Mot de passe enregistré",
        icon: "✅",
      });
      navigate("home", { reset: true });
    });
  }

  void (async () => {
    if (!isPasswordRecoveryPending()) {
      const ok = await checkSession();
      if (!ok) {
        navigate("home", { reset: true });
        return;
      }
    }

    const ok = await checkSession();
    if (!ok) {
      clearPasswordRecoveryPending();
      render(true);
      return;
    }
    render(false);
  })();

  return null;
}
