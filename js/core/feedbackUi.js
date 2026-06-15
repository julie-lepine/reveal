import { INSTAGRAM_PROFILE_URL } from "../../data/appConfig.js";
import { showAppRichDialog } from "./dialog.js";
import { isLobbyEveningStarted } from "./lobby.js";
import { onScreenChange } from "./router.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";

let fabEl = null;

function shouldShowFeedbackFab() {
  return isLobbyEveningStarted();
}

function updateFeedbackFabVisibility() {
  if (!fabEl) return;
  const show = shouldShowFeedbackFab();
  fabEl.classList.toggle("feedback-fab--hidden", !show);
  fabEl.hidden = !show;
}

export function openInstagramProfile() {
  window.open(INSTAGRAM_PROFILE_URL, "_blank", "noopener,noreferrer");
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
