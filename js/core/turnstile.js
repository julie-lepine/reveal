import { HCAPTCHA_SITE_KEY } from "../config/turnstile.js";
import { APP_URL_SCHEME } from "../../data/appConfig.js";
import { isSupabaseConfigured } from "./supabaseClient.js";

const SCRIPT_SRC = "https://js.hcaptcha.com/1/api.js?render=explicit&hl=fr&recaptchacompat=off";

/** @typedef {"login" | "signup" | "reset" | "guest"} TurnstileSlot */

const SLOTS = /** @type {TurnstileSlot[]} */ (["login", "signup", "reset", "guest"]);

/** @type {Record<TurnstileSlot, { widgetId: string | null, solved: boolean, nativeToken: string, onChange: ((solved: boolean) => void) | null }>} */
const slotState = {
  login: { widgetId: null, solved: false, nativeToken: "", onChange: null },
  signup: { widgetId: null, solved: false, nativeToken: "", onChange: null },
  reset: { widgetId: null, solved: false, nativeToken: "", onChange: null },
  guest: { widgetId: null, solved: false, nativeToken: "", onChange: null },
};

let loadPromise = null;

/**
 * Captcha hCaptcha requis dès qu’une site key est configurée.
 * Web, Android et iOS : widget in-page (pas de site tiers, pas Safari).
 */
export function isTurnstileRequired() {
  if (!isSupabaseConfigured()) return false;
  const key = String(HCAPTCHA_SITE_KEY || "").trim();
  return key.length > 0 && !/YOUR_HCAPTCHA|YOUR_TURNSTILE/i.test(key);
}

/** Widget dans le formulaire — toutes plateformes. */
export function usesInPageTurnstile() {
  return isTurnstileRequired();
}

/** Plus de feuille native / Safari. Conservé pour les appels existants. */
export function usesNativeCaptchaSheet() {
  return false;
}

/** @deprecated Utiliser isTurnstileRequired */
export const isTurnstileRequiredForSignup = isTurnstileRequired;

function notifySlot(slot) {
  const solved = isTurnstileSolved(slot);
  slotState[slot].onChange?.(solved);
}

function captchaApi() {
  return typeof window !== "undefined" ? window.hcaptcha : undefined;
}

function loadScript() {
  if (!usesInPageTurnstile()) return Promise.resolve(false);
  if (captchaApi()?.render) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(captchaApi()?.render));
    script.onerror = () => reject(new Error("HCAPTCHA_SCRIPT_FAILED"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function handleNativeCaptchaUrl(rawUrl) {
  if (!rawUrl) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const scheme = String(parsed.protocol || "").replace(/:$/, "");
  if (scheme !== APP_URL_SCHEME) return false;
  return String(parsed.hostname || "").toLowerCase() === "captcha";
}

export function removeTurnstile(slot) {
  const state = slotState[slot];
  const api = captchaApi();
  if (state.widgetId != null && api?.remove) {
    try {
      api.remove(state.widgetId);
    } catch {
      /* ignore */
    }
  }
  state.widgetId = null;
  state.onChange = null;
  state.solved = false;
  state.nativeToken = "";
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

  const api = captchaApi();
  if (!api?.render) {
    state.solved = false;
    notifySlot(slot);
    return { ok: false, error: "Impossible de charger la vérification anti-robot." };
  }

  state.solved = false;
  notifySlot(slot);

  state.widgetId = api.render(container, {
    sitekey: HCAPTCHA_SITE_KEY,
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
    "chalexpired-callback": () => {
      state.solved = false;
      notifySlot(slot);
    },
  });

  return { ok: true };
}

export function getTurnstileToken(slot) {
  if (!isTurnstileRequired()) return null;
  const state = slotState[slot];
  if (state.widgetId == null) return "";
  const api = captchaApi();
  if (!api?.getResponse) return "";
  try {
    return api.getResponse(state.widgetId) || "";
  } catch {
    return "";
  }
}

export function isTurnstileSolved(slot) {
  if (!isTurnstileRequired()) return true;
  const state = slotState[slot];
  if (!state.solved) return false;
  return Boolean(getTurnstileToken(slot));
}

export function isTurnstileMounted(slot) {
  return slotState[slot].widgetId != null;
}

export function setTurnstileOnChange(slot, onChange) {
  slotState[slot].onChange = typeof onChange === "function" ? onChange : null;
  notifySlot(slot);
}

export function resetTurnstile(slot) {
  if (!isTurnstileRequired()) return;
  const state = slotState[slot];
  const api = captchaApi();
  if (state.widgetId != null && api?.reset) {
    try {
      api.reset(state.widgetId);
    } catch {
      /* ignore */
    }
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
