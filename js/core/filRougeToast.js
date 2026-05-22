import { FIL_ROUGE_POINTS_MISSION, FIL_ROUGE_TILE, FIL_ROUGE_VALIDATION } from "../../data/filRouge.js";
import { getFilRougeSession } from "./filRougeSession.js";
import { onGameSessionChange, userIdForName } from "./gameSync.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getLocalDisplayName } from "./state.js";
import { escapeHtml } from "./ui.js";

const TOAST_ID = "fil-rouge-validated-toast";

let lastLocalValidationStatus = null;
let dismissedByUser = false;

function localValidationUid() {
  return getSupabaseUserId() || userIdForName(getLocalDisplayName());
}

function localValidationStatus() {
  const uid = localValidationUid();
  if (!uid) return null;
  return getFilRougeSession().validations?.[uid]?.status ?? null;
}

function hideToast({ dismissed = false } = {}) {
  if (dismissed) dismissedByUser = true;
  document.getElementById(TOAST_ID)?.remove();
}

export function showFilRougeValidatedToast() {
  if (dismissedByUser) return;
  if (document.getElementById(TOAST_ID)) return;

  const root = document.createElement("div");
  root.id = TOAST_ID;
  root.className = "fil-rouge-toast";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <div class="fil-rouge-toast__inner">
      <span class="fil-rouge-toast__emoji" aria-hidden="true">${FIL_ROUGE_TILE.emoji}</span>
      <div class="fil-rouge-toast__text">
        <p class="fil-rouge-toast__title">Mission validée par l'hôte</p>
        <p class="fil-rouge-toast__sub">+${FIL_ROUGE_POINTS_MISSION} pts · ${escapeHtml(FIL_ROUGE_TILE.title)}</p>
      </div>
      <button type="button" class="fil-rouge-toast__close" aria-label="Fermer">×</button>
    </div>`;

  document.body.prepend(root);
  requestAnimationFrame(() => root.classList.add("fil-rouge-toast--in"));

  root.querySelector(".fil-rouge-toast__close")?.addEventListener("click", () => {
    hideToast({ dismissed: true });
  });
}

function ensureValidationToastVisible() {
  const status = localValidationStatus();
  if (status !== FIL_ROUGE_VALIDATION.VALIDATED) {
    hideToast();
    return;
  }
  if (!dismissedByUser) showFilRougeValidatedToast();
}

function onSessionValidationChange() {
  const status = localValidationStatus();
  const prev = lastLocalValidationStatus;
  lastLocalValidationStatus = status;

  if (status === FIL_ROUGE_VALIDATION.PENDING) {
    dismissedByUser = false;
  }

  if (status !== FIL_ROUGE_VALIDATION.VALIDATED) {
    hideToast();
    return;
  }

  if (prev === FIL_ROUGE_VALIDATION.PENDING || !document.getElementById(TOAST_ID)) {
    showFilRougeValidatedToast();
  } else {
    ensureValidationToastVisible();
  }
}

export function initFilRougeValidationListener() {
  lastLocalValidationStatus = localValidationStatus();
  dismissedByUser = false;
  onGameSessionChange(onSessionValidationChange);
  ensureValidationToastVisible();
}
