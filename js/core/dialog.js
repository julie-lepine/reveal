import { escapeHtml } from "./ui.js";

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
