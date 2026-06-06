import { TURNSTILE_SITE_KEY, TURNSTILE_DISABLED } from "../config/turnstile.js";
import { isSupabaseConfigured } from "./supabaseClient.js";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const BYPASS_STORAGE_KEY = "reveal-turnstile-bypass";
const BYPASS_TIMEOUT_MS = 5000;

/** @typedef {"login" | "signup" | "reset" | "guest"} TurnstileSlot */

const SLOTS = /** @type {TurnstileSlot[]} */ (["login", "signup", "reset", "guest"]);

/** @type {Record<TurnstileSlot, { widgetId: string | null, solved: boolean, onChange: ((solved: boolean) => void) | null, bypassTimeoutId: ReturnType<typeof setTimeout> | null }>} */
const slotState = {
  login: { widgetId: null, solved: false, onChange: null, bypassTimeoutId: null },
  signup: { widgetId: null, solved: false, onChange: null, bypassTimeoutId: null },
  reset: { widgetId: null, solved: false, onChange: null, bypassTimeoutId: null },
  guest: { widgetId: null, solved: false, onChange: null, bypassTimeoutId: null },
};

let loadPromise = null;
let skipParamChecked = false;

function isLocalDevHost() {
  if (typeof location === "undefined") return false;
  const host = location.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    location.protocol === "file:"
  );
}

function consumeSkipCaptchaParam() {
  if (typeof location === "undefined") return;
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("skipCaptcha") === "1" || params.get("dev") === "1") {
      sessionStorage.setItem(BYPASS_STORAGE_KEY, "1");
      params.delete("skipCaptcha");
      params.delete("dev");
      const qs = params.toString();
      const next = `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`;
      history.replaceState(null, "", next);
    }
  } catch {
    /* ignore */
  }
}

function isSessionTurnstileBypassed() {
  if (!skipParamChecked) {
    skipParamChecked = true;
    consumeSkipCaptchaParam();
  }
  try {
    return sessionStorage.getItem(BYPASS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function enableTurnstileSessionBypass(reason = "manual") {
  try {
    sessionStorage.setItem(BYPASS_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
  console.warn(`[Turnstile] Vérification anti-robot désactivée pour cette session (${reason}).`);
  for (const slot of SLOTS) {
    clearSlotBypassTimeout(slot);
    if (slotState[slot].widgetId != null && window.turnstile?.remove) {
      try {
        window.turnstile.remove(slotState[slot].widgetId);
      } catch {
        /* ignore */
      }
    }
    slotState[slot].widgetId = null;
    slotState[slot].solved = true;
    notifySlot(slot);
  }
}

export function isTurnstileRequired() {
  if (!isSupabaseConfigured()) return false;
  if (TURNSTILE_DISABLED) return false;
  if (isLocalDevHost()) return false;
  if (isSessionTurnstileBypassed()) return false;
  const key = String(TURNSTILE_SITE_KEY || "").trim();
  return key.length > 0 && !/YOUR_TURNSTILE/i.test(key);
}

/** @deprecated Utiliser isTurnstileRequired */
export const isTurnstileRequiredForSignup = isTurnstileRequired;

function notifySlot(slot) {
  const solved = isTurnstileSolved(slot);
  slotState[slot].onChange?.(solved);
}

function clearSlotBypassTimeout(slot) {
  const state = slotState[slot];
  if (state.bypassTimeoutId) {
    clearTimeout(state.bypassTimeoutId);
    state.bypassTimeoutId = null;
  }
}

function scheduleBypassTimeout(slot) {
  clearSlotBypassTimeout(slot);
  const state = slotState[slot];
  state.bypassTimeoutId = setTimeout(() => {
    state.bypassTimeoutId = null;
    if (!isTurnstileSolved(slot) && isTurnstileRequired()) {
      enableTurnstileSessionBypass("timeout");
    }
  }, BYPASS_TIMEOUT_MS);
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
  clearSlotBypassTimeout(slot);
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
    enableTurnstileSessionBypass("script-load-failed");
    return { ok: true, skipped: true };
  }

  state.solved = false;
  notifySlot(slot);
  scheduleBypassTimeout(slot);

  state.widgetId = window.turnstile.render(container, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: "dark",
    retry: "auto",
    callback: () => {
      clearSlotBypassTimeout(slot);
      state.solved = true;
      notifySlot(slot);
    },
    "expired-callback": () => {
      state.solved = false;
      notifySlot(slot);
      scheduleBypassTimeout(slot);
    },
    "error-callback": () => {
      enableTurnstileSessionBypass("widget-error");
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
  scheduleBypassTimeout(slot);
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
