import { escapeHtml } from "./ui.js";
import { formatSyncErrorMessage, isSyncNetworkError } from "./authErrors.js";
import {
  isTurnstileRequired,
  mountTurnstile,
  removeTurnstile,
  isTurnstileSolved,
  getTurnstileToken,
} from "./turnstile.js";
import { PROFILE_EMOJI_CHOICES } from "../../data/profileEmojis.js";

let openDialog = null;

function removeDialog(root, resolve) {
  root.classList.remove("app-dialog--in");
  root.classList.add("app-dialog--out");
  const done = () => {
    root.remove();
    if (openDialog === root) openDialog = null;
    resolve?.();
  };
  root.addEventListener("transitionend", done, { once: true });
  setTimeout(done, 280);
}

/**
 * Pop-up style REVEAL (remplace window.alert).
 * @returns {Promise<void>}
 */
export function showAppAlert(message, { title = "REVEAL", confirmLabel = "OK", icon = "✨" } = {}) {
  return new Promise((resolve) => {
    if (openDialog) {
      removeDialog(openDialog, () => {});
      openDialog = null;
    }

    const networkError = isSyncNetworkError(message);
    const displayTitle = networkError ? "Connexion" : title;
    const displayIcon = networkError ? "📡" : icon;
    const displayMessage = formatSyncErrorMessage(message);

    const root = document.createElement("div");
    root.className = "app-dialog";
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "app-dialog-title");
    root.setAttribute("aria-describedby", "app-dialog-msg");

    const close = () => removeDialog(root, resolve);

    root.innerHTML = `
      <div class="app-dialog__backdrop" data-dialog-dismiss aria-hidden="true"></div>
      <div class="app-dialog__panel">
        <div class="app-dialog__glow" aria-hidden="true"></div>
        <p class="app-dialog__icon" aria-hidden="true">${displayIcon}</p>
        <p class="app-dialog__title" id="app-dialog-title">${escapeHtml(displayTitle)}</p>
        <p class="app-dialog__message" id="app-dialog-msg">${escapeHtml(displayMessage)}</p>
        <button type="button" class="btn btn-primary app-dialog__btn" data-dialog-ok>${escapeHtml(confirmLabel)}</button>
      </div>
    `;

    root.querySelector("[data-dialog-ok]")?.addEventListener("click", close);
    root.querySelector("[data-dialog-dismiss]")?.addEventListener("click", close);
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    document.body.appendChild(root);
    openDialog = root;
    requestAnimationFrame(() => root.classList.add("app-dialog--in"));
    root.querySelector("[data-dialog-ok]")?.focus();
  });
}

/**
 * Pop-up avec contenu HTML mis en forme (de confiance, non échappé).
 * Utilisée pour les fiches de règles. Panneau scrollable.
 * @returns {Promise<void|"ok"|"cancel">}
 */
export function showAppRichDialog({
  title = "REVEAL",
  icon = "✨",
  bodyHtml = "",
  confirmLabel = "Compris !",
  cancelLabel = null,
} = {}) {
  return new Promise((resolve) => {
    if (openDialog) {
      removeDialog(openDialog, () => {});
      openDialog = null;
    }

    const root = document.createElement("div");
    root.className = "app-dialog";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "app-dialog-title");

    const close = (result) => removeDialog(root, () => resolve(result));

    const actionsHtml = cancelLabel
      ? `<div class="app-dialog__actions">
          <button type="button" class="btn btn-secondary app-dialog__btn" data-dialog-cancel>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn btn-primary app-dialog__btn" data-dialog-ok>${escapeHtml(confirmLabel)}</button>
        </div>`
      : `<button type="button" class="btn btn-primary app-dialog__btn" data-dialog-ok>${escapeHtml(confirmLabel)}</button>`;

    root.innerHTML = `
      <div class="app-dialog__backdrop" data-dialog-dismiss aria-hidden="true"></div>
      <div class="app-dialog__panel app-dialog__panel--rich">
        <div class="app-dialog__glow" aria-hidden="true"></div>
        <p class="app-dialog__icon" aria-hidden="true">${icon}</p>
        <p class="app-dialog__title" id="app-dialog-title">${escapeHtml(title)}</p>
        <div class="app-dialog__rich">${bodyHtml}</div>
        ${actionsHtml}
      </div>
    `;

    root.querySelector("[data-dialog-ok]")?.addEventListener("click", () => close(cancelLabel ? "ok" : undefined));
    root.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => close("cancel"));
    root.querySelector("[data-dialog-dismiss]")?.addEventListener("click", () => close(cancelLabel ? "cancel" : undefined));
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(cancelLabel ? "cancel" : undefined);
    });

    document.body.appendChild(root);
    openDialog = root;
    requestAnimationFrame(() => root.classList.add("app-dialog--in"));
    (root.querySelector(cancelLabel ? "[data-dialog-cancel]" : "[data-dialog-ok]"))?.focus();
  });
}

/**
 * Confirmation (ex. suppression). Retourne true si confirmé.
 * @returns {Promise<boolean>}
 */
export function showAppConfirm(
  message,
  {
    title = "Confirmer",
    confirmLabel = "Confirmer",
    cancelLabel = "Annuler",
    icon = "⚠️",
  } = {}
) {
  return new Promise((resolve) => {
    if (openDialog) {
      removeDialog(openDialog, () => {});
      openDialog = null;
    }

    const root = document.createElement("div");
    root.className = "app-dialog";
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-modal", "true");

    const close = (ok) => removeDialog(root, () => resolve(ok));

    root.innerHTML = `
      <div class="app-dialog__backdrop" data-dialog-dismiss aria-hidden="true"></div>
      <div class="app-dialog__panel">
        <div class="app-dialog__glow" aria-hidden="true"></div>
        <p class="app-dialog__icon" aria-hidden="true">${icon}</p>
        <p class="app-dialog__title">${escapeHtml(title)}</p>
        <p class="app-dialog__message">${escapeHtml(message)}</p>
        <div class="app-dialog__actions">
          <button type="button" class="btn btn-secondary app-dialog__btn" data-dialog-cancel>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn btn-primary app-dialog__btn" data-dialog-ok>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    root.querySelector("[data-dialog-ok]")?.addEventListener("click", () => close(true));
    root.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => close(false));
    root.querySelector("[data-dialog-dismiss]")?.addEventListener("click", () => close(false));
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(false);
    });

    document.body.appendChild(root);
    openDialog = root;
    requestAnimationFrame(() => root.classList.add("app-dialog--in"));
    root.querySelector("[data-dialog-cancel]")?.focus();
  });
}

/**
 * Saisie d’email dans une modale (ex. mot de passe oublié).
 * @returns {Promise<{ ok: true, value: string } | { ok: false }>}
 */
export function showAppEmailPrompt(
  message,
  {
    title = "Email",
    defaultValue = "",
    placeholder = "toi@email.com",
    confirmLabel = "Valider",
    cancelLabel = "Annuler",
    icon = "📧",
  } = {}
) {
  return new Promise((resolve) => {
    if (openDialog) {
      removeDialog(openDialog, () => {});
      openDialog = null;
    }

    const root = document.createElement("div");
    root.className = "app-dialog";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "app-dialog-title");

    const close = (result) => {
      removeTurnstile("reset");
      removeDialog(root, () => resolve(result));
    };

    const turnstileBlock = isTurnstileRequired()
      ? `<div id="app-dialog-turnstile" class="auth-turnstile-wrap auth-turnstile-wrap--dialog"></div>`
      : "";

    root.innerHTML = `
      <div class="app-dialog__backdrop" data-dialog-dismiss aria-hidden="true"></div>
      <div class="app-dialog__panel">
        <div class="app-dialog__glow" aria-hidden="true"></div>
        <p class="app-dialog__icon" aria-hidden="true">${icon}</p>
        <p class="app-dialog__title" id="app-dialog-title">${escapeHtml(title)}</p>
        <p class="app-dialog__message">${escapeHtml(message)}</p>
        <label class="sr-only" for="app-dialog-email">Email</label>
        <input
          type="email"
          class="field-input app-dialog__input"
          id="app-dialog-email"
          placeholder="${escapeHtml(placeholder)}"
          autocomplete="email"
          inputmode="email"
        />
        <p class="app-dialog__field-error hidden" id="app-dialog-email-error" role="alert"></p>
        ${turnstileBlock}
        <div class="app-dialog__actions">
          <button type="button" class="btn btn-secondary app-dialog__btn" data-dialog-cancel>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn btn-primary app-dialog__btn" data-dialog-ok${isTurnstileRequired() ? " disabled" : ""}>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    const input = root.querySelector("#app-dialog-email");
    const fieldErr = root.querySelector("#app-dialog-email-error");
    const okBtn = root.querySelector("[data-dialog-ok]");
    if (input) input.value = String(defaultValue || "").trim();

    const showFieldError = (text) => {
      if (!fieldErr) return;
      if (text) {
        fieldErr.textContent = text;
        fieldErr.classList.remove("hidden");
      } else {
        fieldErr.textContent = "";
        fieldErr.classList.add("hidden");
      }
    };

    if (isTurnstileRequired()) {
      void mountTurnstile("reset", root.querySelector("#app-dialog-turnstile"), {
        onChange: (solved) => {
          if (okBtn) okBtn.disabled = !solved;
        },
      });
    }

    const submit = () => {
      const value = String(input?.value || "").trim();
      if (!value) {
        showFieldError("Entre ton email.");
        input?.focus();
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        showFieldError("Email invalide.");
        input?.focus();
        return;
      }
      if (isTurnstileRequired() && !isTurnstileSolved("reset")) {
        showFieldError("Valide la vérification anti-robot.");
        return;
      }
      const captchaToken = getTurnstileToken("reset");
      close({ ok: true, value, captchaToken });
    };

    root.querySelector("[data-dialog-ok]")?.addEventListener("click", submit);
    root.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => close({ ok: false }));
    root.querySelector("[data-dialog-dismiss]")?.addEventListener("click", () => close({ ok: false }));
    input?.addEventListener("input", () => showFieldError(""));
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close({ ok: false });
    });

    document.body.appendChild(root);
    openDialog = root;
    requestAnimationFrame(() => root.classList.add("app-dialog--in"));
    input?.focus();
    if (input?.value) input.select();
  });
}

/**
 * Choix d'un nouveau hôte dans le lobby.
 * @param {{ userId: string, name: string, emoji?: string }[]} candidates
 * @returns {Promise<{ ok: true, userId: string } | { ok: false }>}
 */
export function showTransferHostDialog(
  candidates = [],
  {
    title = "Transférer l'hôte",
    confirmLabel = "Transférer",
    cancelLabel = "Annuler",
    icon = "👑",
  } = {}
) {
  return new Promise((resolve) => {
    if (openDialog) {
      removeDialog(openDialog, () => {});
      openDialog = null;
    }

    const options = candidates
      .map(
        (p) =>
          `<option value="${escapeHtml(p.userId)}">${escapeHtml(`${p.emoji || "👤"} ${p.name}`)}</option>`
      )
      .join("");

    const root = document.createElement("div");
    root.className = "app-dialog";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "app-dialog-title");

    const close = (result) => removeDialog(root, () => resolve(result));

    root.innerHTML = `
      <div class="app-dialog__backdrop" data-dialog-dismiss aria-hidden="true"></div>
      <div class="app-dialog__panel app-dialog__panel--rich">
        <div class="app-dialog__glow" aria-hidden="true"></div>
        <p class="app-dialog__icon" aria-hidden="true">${icon}</p>
        <p class="app-dialog__title" id="app-dialog-title">${escapeHtml(title)}</p>
        <div class="app-dialog__rich">
          <p>Le joueur choisi pourra lancer les jeux, modifier les réglages et piloter la partie.</p>
          <p>Tu restes dans le lobby mais tu perds le rôle d'hôte. Si une partie est en cours, le nouvel hôte prend le pilotage.</p>
          <label class="field-label" for="app-dialog-host-select">Nouvel hôte</label>
          <select class="field-input" id="app-dialog-host-select" data-dialog-select>
            ${options}
          </select>
        </div>
        <div class="app-dialog__actions">
          <button type="button" class="btn btn-secondary app-dialog__btn" data-dialog-cancel>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn btn-primary app-dialog__btn" data-dialog-ok>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    const select = root.querySelector("[data-dialog-select]");

    const submit = () => {
      const userId = String(select?.value || "").trim();
      if (!userId) return;
      close({ ok: true, userId });
    };

    root.querySelector("[data-dialog-ok]")?.addEventListener("click", submit);
    root.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => close({ ok: false }));
    root.querySelector("[data-dialog-dismiss]")?.addEventListener("click", () => close({ ok: false }));
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close({ ok: false });
    });

    document.body.appendChild(root);
    openDialog = root;
    requestAnimationFrame(() => root.classList.add("app-dialog--in"));
    select?.focus();
  });
}

/**
 * Choix d'un emoji de profil. Le clic sur un emoji valide directement.
 * @param {string} current emoji actuellement sélectionné
 * @returns {Promise<{ ok: true, emoji: string } | { ok: false }>}
 */
export function showEmojiPickerDialog(
  current = "",
  { title = "Choisis ton emoji", icon = "🎭" } = {}
) {
  return new Promise((resolve) => {
    if (openDialog) {
      removeDialog(openDialog, () => {});
      openDialog = null;
    }

    const grid = PROFILE_EMOJI_CHOICES.map(
      (e) =>
        `<button type="button" class="emoji-picker__btn ${e === current ? "emoji-picker__btn--active" : ""}" data-emoji="${e}" aria-label="${e}">${e}</button>`
    ).join("");

    const root = document.createElement("div");
    root.className = "app-dialog";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "app-dialog-title");

    const close = (result) => removeDialog(root, () => resolve(result));

    root.innerHTML = `
      <div class="app-dialog__backdrop" data-dialog-dismiss aria-hidden="true"></div>
      <div class="app-dialog__panel app-dialog__panel--rich">
        <div class="app-dialog__glow" aria-hidden="true"></div>
        <p class="app-dialog__icon" aria-hidden="true">${icon}</p>
        <p class="app-dialog__title" id="app-dialog-title">${escapeHtml(title)}</p>
        <div class="app-dialog__rich">
          <div class="emoji-picker" role="listbox" aria-label="Choisir un emoji">
            ${grid}
          </div>
        </div>
        <button type="button" class="btn btn-secondary app-dialog__btn" data-dialog-cancel>Annuler</button>
      </div>
    `;

    root.querySelectorAll("[data-emoji]").forEach((btn) => {
      btn.addEventListener("click", () =>
        close({ ok: true, emoji: btn.getAttribute("data-emoji") })
      );
    });
    root.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => close({ ok: false }));
    root.querySelector("[data-dialog-dismiss]")?.addEventListener("click", () => close({ ok: false }));
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close({ ok: false });
    });

    document.body.appendChild(root);
    openDialog = root;
    requestAnimationFrame(() => root.classList.add("app-dialog--in"));
    root.querySelector(".emoji-picker__btn--active, [data-emoji]")?.focus();
  });
}
