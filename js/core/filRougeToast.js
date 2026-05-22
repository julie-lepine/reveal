import { FIL_ROUGE_POINTS_MISSION, FIL_ROUGE_TILE, FIL_ROUGE_VALIDATION } from "../../data/filRouge.js";
import { getFilRougeSession } from "./filRougeSession.js";
import { onGameSessionChange } from "./gameSync.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { userIdForName } from "./gameSync.js";
import { getLocalDisplayName } from "./state.js";
import { escapeHtml } from "./ui.js";

const TOAST_ID = "fil-rouge-validated-toast";
const AUTO_DISMISS_MS = 7000;

let lastLocalValidationStatus = null;
let dismissTimer = null;

function localValidationUid() {
  return getSupabaseUserId() || userIdForName(getLocalDisplayName());
}

function localValidationStatus() {
  const uid = localValidationUid();
  if (!uid) return null;
  return getFilRougeSession().validations?.[uid]?.status ?? null;
}

function hideToast() {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  document.getElementById(TOAST_ID)?.remove();
}

export function showFilRougeValidatedToast() {
  hideToast();
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

  root.querySelector(".fil-rouge-toast__close")?.addEventListener("click", hideToast);
  dismissTimer = setTimeout(hideToast, AUTO_DISMISS_MS);
}

function onSessionValidationChange() {
  const status = localValidationStatus();
  if (
    lastLocalValidationStatus === FIL_ROUGE_VALIDATION.PENDING &&
    status === FIL_ROUGE_VALIDATION.VALIDATED
  ) {
    showFilRougeValidatedToast();
  }
  lastLocalValidationStatus = status;
}

export function initFilRougeValidationListener() {
  lastLocalValidationStatus = localValidationStatus();
  onGameSessionChange(onSessionValidationChange);
}
