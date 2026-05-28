import { TURNSTILE_SITE_KEY } from "../config/turnstile.js";
import { isSupabaseConfigured } from "./supabaseClient.js";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** @typedef {"login" | "signup" | "reset"} TurnstileSlot */

const SLOTS = /** @type {TurnstileSlot[]} */ (["login", "signup", "reset"]);

/** @type {Record<TurnstileSlot, { widgetId: string | null, solved: boolean, onChange: ((solved: boolean) => void) | null }>} */
const slotState = {
  login: { widgetId: null, solved: false, onChange: null },
  signup: { widgetId: null, solved: false, onChange: null },
  reset: { widgetId: null, solved: false, onChange: null },
};

let loadPromise = null;

export function isTurnstileRequired() {
  if (!isSupabaseConfigured()) return false;
  const key = String(TURNSTILE_SITE_KEY || "").trim();
  return key.length > 0 && !/YOUR_TURNSTILE/i.test(key);
}

/** @deprecated Utiliser isTurnstileRequired */
export const isTurnstileRequiredForSignup = isTurnstileRequired;

function notifySlot(slot) {
  const solved = isTurnstileSolved(slot);
  slotState[slot].onChange?.(solved);
}

function loadScript() {
  if (!isTurnstileRequired()) return Promise.resolve(false);
  if (window.turnstile) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(window.turnstile));
    script.onerror = () => reject(new Error("TURNSTILE_SCRIPT_FAILED"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function removeTurnstile(slot) {
  const state = slotState[slot];
  if (state.widgetId != null && window.turnstile?.remove) {
    try {
      window.turnstile.remove(state.widgetId);
    } catch {
      /* ignore */
    }
  }
  state.widgetId = null;
  state.solved = false;
  state.onChange = null;
}

export function removeAllTurnstile() {
  for (const slot of SLOTS) removeTurnstile(slot);
}

export async function mountTurnstile(slot, container, { onChange } = {}) {
  removeTurnstile(slot);
  const state = slotState[slot];
  state.onChange = typeof onChange === "function" ? onChange : null;

  if (!container || !isTurnstileRequired()) {
    state.solved = true;
    notifySlot(slot);
    return { ok: true, skipped: true };
  }

  try {
    await loadScript();
  } catch {
    state.solved = false;
    notifySlot(slot);
    return { ok: false, error: "Impossible de charger la vérification anti-robot." };
  }

  state.solved = false;
  notifySlot(slot);

  state.widgetId = window.turnstile.render(container, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: "dark",
    callback: () => {
      state.solved = true;
      notifySlot(slot);
    },
    "expired-callback": () => {
      state.solved = false;
      notifySlot(slot);
    },
    "error-callback": () => {
      state.solved = false;
      notifySlot(slot);
    },
  });

  return { ok: true };
}

export function getTurnstileToken(slot) {
  if (!isTurnstileRequired()) return null;
  const state = slotState[slot];
  if (state.widgetId == null || !window.turnstile?.getResponse) return "";
  return window.turnstile.getResponse(state.widgetId) || "";
}

export function isTurnstileSolved(slot) {
  if (!isTurnstileRequired()) return true;
  const state = slotState[slot];
  if (!state.solved) return false;
  return Boolean(getTurnstileToken(slot));
}

export function resetTurnstile(slot) {
  if (!isTurnstileRequired()) return;
  const state = slotState[slot];
  if (state.widgetId != null && window.turnstile?.reset) {
    window.turnstile.reset(state.widgetId);
  }
  state.solved = false;
  notifySlot(slot);
}

export const mountSignupTurnstile = (container, opts) => mountTurnstile("signup", container, opts);
export const mountLoginTurnstile = (container, opts) => mountTurnstile("login", container, opts);
export const removeSignupTurnstile = () => removeTurnstile("signup");
export const getSignupTurnstileToken = () => getTurnstileToken("signup");
export const isSignupTurnstileSolved = () => isTurnstileSolved("signup");
export const resetSignupTurnstile = () => resetTurnstile("signup");
export const getLoginTurnstileToken = () => getTurnstileToken("login");
export const isLoginTurnstileSolved = () => isTurnstileSolved("login");
export const resetLoginTurnstile = () => resetTurnstile("login");
