import { INSTAGRAM_HANDLE, INSTAGRAM_PROFILE_URL } from "../../data/appConfig.js";
import { showAppRichDialog } from "./dialog.js";
import { hasActiveLobby, isLobbyEveningStarted } from "./lobby.js";
import { openExternalUrl } from "./openExternal.js";
import { getCurrentScreen, onScreenChange } from "./router.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";
import { escapeHtml } from "./ui.js";

let fabEl = null;

/** Hub soirée : le bouton retour Insta reste visible entre deux parties. */
const FEEDBACK_HUB_SCREENS = new Set(["game-select", "results", "leaderboard"]);

function shouldShowFeedbackFab() {
  if (!hasActiveLobby()) return false;
  if (isLobbyEveningStarted()) return true;
  return FEEDBACK_HUB_SCREENS.has(getCurrentScreen());
}

function updateFeedbackFabVisibility() {
  if (!fabEl) return;
  const show = shouldShowFeedbackFab();
  fabEl.classList.toggle("feedback-fab--hidden", !show);
  fabEl.hidden = !show;
}

export function openInstagramProfile() {
  void openExternalUrl(INSTAGRAM_PROFILE_URL);
}

export function openFeedbackDialog() {
  void showAppRichDialog({
    title: "Un retour ?",
    icon: "💬",
    bodyHtml: `
      <p class="feedback-modal__text">
        Tu joues à REVEAL ? J'aimerais avoir ton avis : bug, idée de mini-jeu, mot trop facile…
        Envoie-moi un DM sur Insta, je réponds dès que je peux.
      </p>`,
    cancelLabel: "Plus tard",
    confirmLabel: "Envoie un DM",
  }).then((choice) => {
    if (choice === "ok") openInstagramProfile();
  });
}

export function feedbackPromptCardHtml() {
  return `
    <div class="card settings-section game-select-feedback">
      <h2 class="settings-section__title">Un retour ?</h2>
      <p class="hint settings-section__hint">
        Bug, idée de jeu ou mot à ajouter ? Écris-nous sur Instagram
        <strong>@${escapeHtml(INSTAGRAM_HANDLE)}</strong>.
      </p>
      <a
        class="btn btn-secondary btn--spaced"
        href="${escapeHtml(INSTAGRAM_PROFILE_URL)}"
        target="_blank"
        rel="noopener noreferrer"
        data-open-feedback-dm
      >Envoie un DM</a>
    </div>`;
}

export function bindFeedbackPrompt(root) {
  root.querySelectorAll("[data-open-feedback-dm]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openInstagramProfile();
    });
  });
}

export function initFeedbackFab() {
  if (fabEl || typeof document === "undefined") return;

  fabEl = document.createElement("button");
  fabEl.type = "button";
  fabEl.id = "feedback-fab";
  fabEl.className = "feedback-fab feedback-fab--hidden";
  fabEl.setAttribute("aria-label", "Envoyer un retour");
  fabEl.hidden = true;
  fabEl.textContent = "💬";
  fabEl.addEventListener("click", openFeedbackDialog);

  document.body.appendChild(fabEl);
  updateFeedbackFabVisibility();

  onScreenChange(() => updateFeedbackFabVisibility());
  onLobbyBundleUpdated(() => updateFeedbackFabVisibility());
}
