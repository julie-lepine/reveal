import { TURNSTILE_SITE_KEY } from "../config/turnstile.js";
import { NATIVE_CAPTCHA_PAGE_URL, APP_URL_SCHEME } from "../../data/appConfig.js";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { isNativeApp } from "./platform.js";
import { loadCapacitorInAppBrowser } from "./capacitorImports.js";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const NATIVE_CHANNEL_PREFIX = "captcha-handoff-";
const NATIVE_CHALLENGE_TIMEOUT_MS = 120000;

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

/** @type {null | { slot: TurnstileSlot, sid: string, settle: (token: string | null, reason?: string) => void }} */
let nativeChallenge = null;

/**
 * Captcha requis dès qu’une site key est configurée (web + app native).
 * Web : widget in-page. Native : WebView in-app (Turnstile casse dans la WebView Capacitor du formulaire).
 */
export function isTurnstileRequired() {
  if (!isSupabaseConfigured()) return false;
  const key = String(TURNSTILE_SITE_KEY || "").trim();
  return key.length > 0 && !/YOUR_TURNSTILE/i.test(key);
}

/** Widget Cloudflare dans la page (navigateur seulement). */
export function usesInPageTurnstile() {
  return isTurnstileRequired() && !isNativeApp();
}

/** Défi Turnstile dans une WebView in-app (reste dans REVEAL, pas Safari). */
export function usesNativeCaptchaSheet() {
  return isTurnstileRequired() && isNativeApp();
}

/** @deprecated Utiliser isTurnstileRequired */
export const isTurnstileRequiredForSignup = isTurnstileRequired;

function notifySlot(slot) {
  const solved = isTurnstileSolved(slot);
  slotState[slot].onChange?.(solved);
}

function loadScript() {
  if (!usesInPageTurnstile()) return Promise.resolve(false);
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

function paintNativeCaptcha(container, slot) {
  const solved = isTurnstileSolved(slot);
  container.innerHTML = `
    <div class="auth-captcha-native${solved ? " is-solved" : ""}" data-native-captcha="${slot}">
      <button type="button" class="btn btn-secondary auth-captcha-native__btn" data-native-captcha-open>
        ${solved ? "Vérifié" : "Je ne suis pas un robot"}
      </button>
      <p class="hint auth-captcha-native__status">${solved ? "Vérification anti-robot OK." : "Touche pour ouvrir la vérification dans l’app."}</p>
    </div>
  `;
  const btn = container.querySelector("[data-native-captcha-open]");
  if (btn && solved) btn.disabled = true;
  btn?.addEventListener("click", () => {
    void startNativeCaptcha(slot, container);
  });
}

function setNativeStatus(container, { solved, pending, error }) {
  const wrap = container?.querySelector(".auth-captcha-native");
  const btn = container?.querySelector("[data-native-captcha-open]");
  const status = container?.querySelector(".auth-captcha-native__status");
  if (!wrap || !btn || !status) return;
  wrap.classList.toggle("is-solved", Boolean(solved));
  btn.disabled = Boolean(solved || pending);
  if (pending) {
    btn.textContent = "Vérification…";
    status.textContent = "Termine la vérification, sans quitter REVEAL.";
  } else if (solved) {
    btn.textContent = "Vérifié";
    status.textContent = "Vérification anti-robot OK.";
  } else {
    btn.textContent = "Je ne suis pas un robot";
    status.textContent = error || "Touche pour ouvrir la vérification dans l’app.";
  }
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
  if (String(parsed.hostname || "").toLowerCase() !== "captcha") return false;
  void closeNativeCaptchaView();
  return true;
}

async function closeNativeCaptchaView() {
  try {
    const mod = await loadCapacitorInAppBrowser();
    await mod?.InAppBrowser?.close?.();
  } catch {
    /* déjà fermé */
  }
}

function tokenFromWebviewMessage(event) {
  const detail = event?.detail;
  if (detail && typeof detail === "object") {
    const token = String(detail.token || "").trim();
    if (token) return token;
  }
  return String(event?.payload?.token || "").trim();
}

async function startNativeCaptcha(slot, container) {
  if (!usesNativeCaptchaSheet() || !supabase) {
    return { ok: false, error: "Vérification anti-robot indisponible." };
  }
  if (nativeChallenge) return { ok: false, error: "Vérification déjà en cours." };

  const sid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `c${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channelName = `${NATIVE_CHANNEL_PREFIX}${sid}`;
  const channel = supabase.channel(channelName, {
    config: { broadcast: { ack: true } },
  });
  let settled = false;
  let finishTimer = 0;
  const listenerHandles = [];

  const cleanup = async () => {
    window.clearTimeout(finishTimer);
    for (const handle of listenerHandles) {
      try {
        await handle?.remove?.();
      } catch {
        /* ignore */
      }
    }
    try {
      await supabase.removeChannel(channel);
    } catch {
      /* ignore */
    }
    if (nativeChallenge?.sid === sid) nativeChallenge = null;
  };

  const waitForToken = new Promise((resolve) => {
    nativeChallenge = {
      slot,
      sid,
      settle(token, reason) {
        if (settled) return;
        settled = true;
        resolve({ token: token || "", reason: reason || "" });
      },
    };
  });

  channel.on("broadcast", { event: "token" }, (msg) => {
    const token = String(msg?.payload?.token || "").trim();
    if (token) nativeChallenge?.settle(token, "broadcast");
  });
  channel.subscribe();

  setNativeStatus(container, { pending: true });

  try {
    const mod = await loadCapacitorInAppBrowser();
    const InAppBrowser = mod?.InAppBrowser;
    if (!InAppBrowser?.openWebView) {
      await cleanup();
      setNativeStatus(container, { error: "Impossible d’ouvrir la vérification." });
      notifySlot(slot);
      return { ok: false, error: "Impossible d’ouvrir la vérification anti-robot." };
    }

    const addListener = async (eventName, fn) => {
      if (typeof InAppBrowser.addListener !== "function") return;
      const maybe = InAppBrowser.addListener(eventName, fn);
      const handle = maybe && typeof maybe.then === "function" ? await maybe : maybe;
      if (handle) listenerHandles.push(handle);
    };

    await addListener("messageFromWebview", (event) => {
      const token = tokenFromWebviewMessage(event);
      if (token) nativeChallenge?.settle(token, "message");
    });
    await addListener("closeEvent", () => {
      window.setTimeout(() => {
        nativeChallenge?.settle("", "closed");
      }, 400);
    });

    const pageUrl = new URL(NATIVE_CAPTCHA_PAGE_URL);
    pageUrl.searchParams.set("sid", sid);

    await InAppBrowser.openWebView({
      url: pageUrl.toString(),
      title: "Vérification",
      toolbarType: "",
      backgroundColor: "black",
      isAnimated: true,
      activeNativeNavigationForWebview: false,
    });

    const timeout = new Promise((resolve) => {
      window.setTimeout(() => resolve({ token: "", reason: "timeout" }), NATIVE_CHALLENGE_TIMEOUT_MS);
    });

    const first = await Promise.race([waitForToken, timeout]);
    let token = String(first.token || "").trim();

    if (!token && first.reason === "closed") {
      const late = await Promise.race([
        waitForToken,
        new Promise((resolve) => {
          finishTimer = window.setTimeout(() => resolve({ token: "", reason: "late" }), 1500);
        }),
      ]);
      token = String(late.token || "").trim();
    }

    await closeNativeCaptchaView();
    await cleanup();

    const state = slotState[slot];
    if (token) {
      state.nativeToken = token;
      state.solved = true;
      setNativeStatus(container, { solved: true });
      notifySlot(slot);
      return { ok: true };
    }

    state.nativeToken = "";
    state.solved = false;
    const error =
      first.reason === "timeout"
        ? "Vérification expirée. Réessaie."
        : "Vérification annulée.";
    setNativeStatus(container, { error });
    notifySlot(slot);
    return { ok: false, error };
  } catch (err) {
    await closeNativeCaptchaView();
    await cleanup();
    slotState[slot].nativeToken = "";
    slotState[slot].solved = false;
    const error = "Impossible d’ouvrir la vérification anti-robot.";
    setNativeStatus(container, { error });
    notifySlot(slot);
    console.warn("REVEAL native captcha:", err?.message || err);
    return { ok: false, error };
  }
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
  state.onChange = null;
  if (!usesNativeCaptchaSheet()) {
    state.solved = false;
    state.nativeToken = "";
  }
}

export function removeAllTurnstile() {
  for (const slot of SLOTS) {
    if (usesNativeCaptchaSheet()) {
      slotState[slot].nativeToken = "";
      slotState[slot].solved = false;
    }
    removeTurnstile(slot);
  }
}

export async function mountTurnstile(slot, container, { onChange } = {}) {
  const keptNativeToken = usesNativeCaptchaSheet() ? slotState[slot].nativeToken : "";
  const keptNativeSolved = usesNativeCaptchaSheet() ? slotState[slot].solved : false;
  removeTurnstile(slot);
  const state = slotState[slot];
  state.onChange = typeof onChange === "function" ? onChange : null;
  if (usesNativeCaptchaSheet()) {
    state.nativeToken = keptNativeToken;
    state.solved = keptNativeSolved && Boolean(keptNativeToken);
  }

  if (!container || !isTurnstileRequired()) {
    state.solved = true;
    notifySlot(slot);
    return { ok: true, skipped: true };
  }

  if (usesNativeCaptchaSheet()) {
    paintNativeCaptcha(container, slot);
    notifySlot(slot);
    return { ok: true, native: true };
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
    size: "flexible",
    appearance: "always",
    retry: "auto",
    language: "fr",
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
  if (usesNativeCaptchaSheet()) return state.nativeToken || "";
  if (state.widgetId == null || !window.turnstile?.getResponse) return "";
  return window.turnstile.getResponse(state.widgetId) || "";
}

export function isTurnstileSolved(slot) {
  if (!isTurnstileRequired()) return true;
  const state = slotState[slot];
  if (!state.solved) return false;
  return Boolean(getTurnstileToken(slot));
}

export function isTurnstileMounted(slot) {
  if (usesNativeCaptchaSheet()) {
    return slotState[slot].solved || slotState[slot].onChange != null;
  }
  return slotState[slot].widgetId != null;
}

export function setTurnstileOnChange(slot, onChange) {
  slotState[slot].onChange = typeof onChange === "function" ? onChange : null;
  notifySlot(slot);
}

export function resetTurnstile(slot) {
  if (!isTurnstileRequired()) return;
  const state = slotState[slot];
  if (usesNativeCaptchaSheet()) {
    state.nativeToken = "";
    state.solved = false;
    notifySlot(slot);
    return;
  }
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
