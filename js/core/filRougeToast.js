import { FIL_ROUGE_POINTS_MISSION, FIL_ROUGE_TILE, FIL_ROUGE_VALIDATION } from "../../data/filRouge.js";
import { getFilRougeSession } from "./filRougeSession.js";
import { onGameSessionChange, userIdForName } from "./gameSync.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getLocalDisplayName, getState } from "./state.js";
import { escapeHtml } from "./ui.js";

const TOAST_ID = "fil-rouge-validated-toast";
const DISMISS_PREFIX = "reveal-fil-rouge-validation-toast-dismissed:";

let lastLocalValidationStatus = null;

function localValidationUid() {
  return getSupabaseUserId() || userIdForName(getLocalDisplayName());
}

function localValidationEntry() {
  const uid = localValidationUid();
  if (!uid) return null;
  return getFilRougeSession().validations?.[uid] ?? null;
}

function localValidationStatus() {
  return localValidationEntry()?.status ?? null;
}

/** Clé par lobby + joueur + instant de validation (nouvelle validation = nouvelle toast). */
function dismissStorageKey() {
  const uid = localValidationUid();
  const entry = localValidationEntry();
  if (!uid || entry?.status !== FIL_ROUGE_VALIDATION.VALIDATED) return null;
  const lobbyId = getState().lobby?.id || getState().lobbyCode || "no-lobby";
  const at = entry.validatedAt || "validated";
  return `${DISMISS_PREFIX}${lobbyId}:${uid}:${at}`;
}

function isValidationToastDismissed() {
  const key = dismissStorageKey();
  if (!key) return false;
  return localStorage.getItem(key) === "1";
}

function persistValidationToastDismissed() {
  const key = dismissStorageKey();
  if (key) localStorage.setItem(key, "1");
}

function hideToast({ persistDismiss = false } = {}) {
  if (persistDismiss) persistValidationToastDismissed();
  document.getElementById(TOAST_ID)?.remove();
}

export function showFilRougeValidatedToast() {
  if (isValidationToastDismissed()) return;
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
    hideToast({ persistDismiss: true });
  });
}

function ensureValidationToastVisible() {
  const status = localValidationStatus();
  if (status !== FIL_ROUGE_VALIDATION.VALIDATED) {
    hideToast();
    return;
  }
  if (!isValidationToastDismissed()) showFilRougeValidatedToast();
}

function onSessionValidationChange() {
  const status = localValidationStatus();
  const prev = lastLocalValidationStatus;
  lastLocalValidationStatus = status;

  if (status !== FIL_ROUGE_VALIDATION.VALIDATED) {
    hideToast();
    return;
  }

  if (isValidationToastDismissed()) {
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
  onGameSessionChange(onSessionValidationChange);
  ensureValidationToastVisible();
}
