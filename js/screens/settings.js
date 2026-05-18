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
import { isTimerMuted, setTimerMuted } from "../core/settings.js";
import { onTimerSecond, primeTimerSound } from "../core/timerSound.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountSettings(app) {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return null;
  }

  const user = getUser();
  const emailAccount = isEmailAccount();

  let selectedEmoji = getLocalEmoji();

  function render() {
    const muted = isTimerMuted();
    selectedEmoji = getLocalEmoji();

    app.innerHTML = pageShell({
      content: `
        <p class="label-upper">Paramètres</p>
        <h1 class="page-title">Ton profil</h1>

        <div class="card settings-section">
          <h2 class="settings-section__title">Son des timers</h2>
          <p class="hint settings-section__hint">Tick chrono pendant les votes et décomptes.</p>
          <label class="settings-toggle">
            <span class="settings-toggle__label">Sons du chrono</span>
            <input type="checkbox" class="settings-toggle__input" id="toggle-timer-sound" ${muted ? "" : "checked"} />
            <span class="settings-toggle__track" aria-hidden="true"></span>
          </label>
          <button type="button" class="btn btn-secondary btn--compact" id="btn-test-sound" ${muted ? "disabled" : ""}>
            Tester le son
          </button>
        </div>

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
              ? `<p class="hint settings-social-hint">Compte ${escapeHtml(user.provider || "social")} — le mot de passe se gère chez le fournisseur.</p>`
              : ""
        }
      `,
    });

    bindNav(app);
    bindEvents();
  }

  function bindEvents() {
    const toggle = app.querySelector("#toggle-timer-sound");
    const testBtn = app.querySelector("#btn-test-sound");

    toggle?.addEventListener("change", () => {
      const on = toggle.checked;
      setTimerMuted(!on);
      if (testBtn) testBtn.disabled = !on;
    });

    testBtn?.addEventListener("click", () => {
      primeTimerSound();
      onTimerSecond({ remaining: 3, urgentAt: 5, force: true });
    });

    app.querySelectorAll(".emoji-picker__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const emoji = btn.getAttribute("data-emoji");
        const res = updateProfileEmoji(emoji);
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

    app.querySelector("#btn-save-name")?.addEventListener("click", () => {
      const err = app.querySelector("#name-error");
      const ok = app.querySelector("#name-ok");
      const res = updateProfileName(app.querySelector("#settings-name").value);
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

    app.querySelector("#btn-save-password")?.addEventListener("click", () => {
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

      const res = changeEmailPassword(current, next);
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
