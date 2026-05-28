import { escapeHtml } from "./ui.js";
import {
  isTurnstileRequired,
  mountTurnstile,
  removeTurnstile,
  isTurnstileSolved,
  getTurnstileToken,
} from "./turnstile.js";

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
        <p class="app-dialog__icon" aria-hidden="true">${icon}</p>
        <p class="app-dialog__title" id="app-dialog-title">${escapeHtml(title)}</p>
        <p class="app-dialog__message" id="app-dialog-msg">${escapeHtml(message)}</p>
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
