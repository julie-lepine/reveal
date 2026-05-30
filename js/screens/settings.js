import {
  canPlay,
  isEmailAccount,
  getUser,
  updateProfileName,
  updateProfileEmoji,
  changeEmailPassword,
} from "../core/auth.js";
import { getLocalDisplayName, getLocalEmoji } from "../core/state.js";
import { PROFILE_EMOJI_CHOICES } from "../../data/profileEmojis.js";
import { hasActiveLobby, getLobby } from "../core/lobby.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav, goToEveningSettings, returnFromEveningProfile } from "./nav.js";

export function mountSettings(app) {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return null;
  }

  const user = getUser();
  const emailAccount = isEmailAccount();

  let selectedEmoji = getLocalEmoji();

  function render() {
    selectedEmoji = getLocalEmoji();
    const inLobby = hasActiveLobby();
    const lobbyCode = inLobby ? getLobby()?.code : "";

    app.innerHTML = pageShell({
      back: !inLobby,
      content: `
        <p class="label-upper">Paramètres</p>
        <h1 class="page-title">Ton profil</h1>

        ${
          inLobby
            ? `
        <div class="card card--highlight settings-lobby-banner">
          <p class="hint settings-lobby-banner__text">
            Soirée en cours - lobby <strong>${escapeHtml(lobbyCode || "")}</strong>.
            Tu restes connecté : pseudo et emoji s’appliquent pour tout le monde.
          </p>
          <button type="button" class="btn btn-accent btn--spaced" data-nav="evening-return">Retour aux jeux</button>
        </div>`
            : ""
        }

        <div class="card settings-section">
          <h2 class="settings-section__title">Emoji</h2>
          <p class="hint settings-section__hint">Affiché dans le lobby et les classements.</p>
          <div class="emoji-picker-preview">
            <span class="emoji-picker-preview__avatar" id="emoji-preview">${selectedEmoji}</span>
            <span class="hint">Aperçu de ton avatar</span>
          </div>
          <div class="emoji-picker" role="listbox" aria-label="Choisir un emoji">
            ${PROFILE_EMOJI_CHOICES.map(
              (e) => `
              <button type="button" class="emoji-picker__btn ${e === selectedEmoji ? "emoji-picker__btn--active" : ""}" data-emoji="${e}" aria-label="${e}">${e}</button>`
            ).join("")}
          </div>
          <p class="settings-ok hidden" id="emoji-ok">Emoji enregistré.</p>
        </div>

        <div class="card settings-section">
          <h2 class="settings-section__title">Pseudo</h2>
          <p class="hint settings-section__hint">Visible dans le lobby et les scores.</p>
          <label class="field-label" for="settings-name">Ton pseudo</label>
          <input type="text" class="field-input" id="settings-name" maxlength="24" value="${escapeHtml(getLocalDisplayName())}" />
          <p class="auth-error hidden" id="name-error"></p>
          <p class="settings-ok hidden" id="name-ok">Pseudo enregistré.</p>
          <button type="button" class="btn btn-primary btn--spaced" id="btn-save-name">Enregistrer le pseudo</button>
        </div>

        ${
          emailAccount
            ? `
        <div class="card settings-section">
          <h2 class="settings-section__title">Mot de passe</h2>
          <p class="hint settings-section__hint">Compte ${escapeHtml(user.email)}</p>
          <label class="field-label" for="pwd-current">Mot de passe actuel</label>
          <input type="password" class="field-input" id="pwd-current" autocomplete="current-password" />
          <label class="field-label" for="pwd-new">Nouveau mot de passe</label>
          <input type="password" class="field-input" id="pwd-new" autocomplete="new-password" placeholder="4 caractères min." />
          <label class="field-label" for="pwd-confirm">Confirmer</label>
          <input type="password" class="field-input" id="pwd-confirm" autocomplete="new-password" />
          <p class="auth-error hidden" id="pwd-error"></p>
          <p class="settings-ok hidden" id="pwd-ok">Mot de passe mis à jour.</p>
          <button type="button" class="btn btn-primary btn--spaced" id="btn-save-password">Changer le mot de passe</button>
        </div>`
            : user.loggedIn
              ? `<p class="hint settings-social-hint">Compte ${escapeHtml(user.provider || "social")} - le mot de passe se gère chez le fournisseur.</p>`
              : ""
        }

        <div class="card settings-section">
          <h2 class="settings-section__title">Légal</h2>
          <p class="hint settings-section__hint">Politique de confidentialité (RGPD, AdMob, Supabase).</p>
          <button type="button" class="btn btn-secondary btn--spaced" data-nav="privacy">Politique de confidentialité</button>
        </div>
      `,
    });

    bindNav(app, {
      "evening-return": () => returnFromEveningProfile(),
    });
    bindEvents();
  }

  function bindEvents() {
    app.querySelectorAll(".emoji-picker__btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const emoji = btn.getAttribute("data-emoji");
        const res = await updateProfileEmoji(emoji);
        if (!res.ok) return;

        selectedEmoji = res.emoji;
        app.querySelector("#emoji-preview").textContent = res.emoji;
        app.querySelectorAll(".emoji-picker__btn").forEach((b) => {
          b.classList.toggle("emoji-picker__btn--active", b === btn);
        });
        const ok = app.querySelector("#emoji-ok");
        ok?.classList.remove("hidden");
      });
    });

    app.querySelector("#btn-save-name")?.addEventListener("click", async () => {
      const err = app.querySelector("#name-error");
      const ok = app.querySelector("#name-ok");
      const res = await updateProfileName(app.querySelector("#settings-name").value);
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        ok?.classList.add("hidden");
        return;
      }
      err.classList.add("hidden");
      ok?.classList.remove("hidden");
      app.querySelector("#settings-name").value = res.name;
    });

    app.querySelector("#btn-save-password")?.addEventListener("click", async () => {
      const err = app.querySelector("#pwd-error");
      const ok = app.querySelector("#pwd-ok");
      err.classList.add("hidden");
      ok?.classList.add("hidden");

      const current = app.querySelector("#pwd-current").value;
      const next = app.querySelector("#pwd-new").value;
      const confirm = app.querySelector("#pwd-confirm").value;

      if (next !== confirm) {
        err.textContent = "Les deux mots de passe ne correspondent pas.";
        err.classList.remove("hidden");
        return;
      }

      const res = await changeEmailPassword(current, next);
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }

      app.querySelector("#pwd-current").value = "";
      app.querySelector("#pwd-new").value = "";
      app.querySelector("#pwd-confirm").value = "";
      ok?.classList.remove("hidden");
    });
  }

  render();
  return null;
}
