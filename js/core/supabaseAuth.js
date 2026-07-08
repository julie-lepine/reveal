import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getState, saveStatePatch } from "./state.js";
import { fetchProfile, upsertProfile } from "./supabaseProfile.js";
import { formatAuthErrorMessage, isAuthRateLimitError, isAuthCaptchaError } from "./authErrors.js";
import {
  getPasswordResetCooldownRemainingMs,
  markPasswordResetSent,
  markPasswordResetRateLimited,
  passwordResetCooldownMessage,
} from "./passwordResetCooldown.js";
import { isNativeApp } from "./platform.js";
import { NATIVE_AUTH_REDIRECT } from "../../data/appConfig.js";
import { loadGuestMembership } from "./guestMembership.js";

const PASSWORD_RECOVERY_KEY = "reveal-pending-password-reset";

let authReadyResolve = null;
let authInitFinished = false;
let authInitialSessionSeen = false;
let authReadyResolved = false;

/**
 * Résolue quand l'init Supabase auth est terminée (session restaurée si possible)
 * ET que Supabase a émis `INITIAL_SESSION` (évite les races au boot).
 */
export const authReady = new Promise((resolve) => {
  authReadyResolve = resolve;
});

function resolveAuthReadyIfComplete(reason = "unknown") {
  if (authReadyResolved) return;
  if (!authInitFinished || !authInitialSessionSeen) return;
  authReadyResolved = true;
  try {
    console.debug("[Auth] ready", reason);
  } catch {
    /* ignore */
  }
  authReadyResolve?.();
}

export function getAuthRedirectUrl() {
  if (isNativeApp()) return NATIVE_AUTH_REDIRECT;
  const base = window.location.origin + window.location.pathname;
  return base.replace(/\/$/, "") || base;
}

export function parseAuthParamsFromUrl(rawUrl) {
  const url = String(rawUrl || "");
  const hashIdx = url.indexOf("#");
  const qIdx = url.indexOf("?");

  let hash = hashIdx >= 0 ? url.slice(hashIdx + 1) : "";
  let search = "";
  if (qIdx >= 0) {
    const end = hashIdx >= 0 ? hashIdx : url.length;
    search = url.slice(qIdx + 1, end);
  }

  return {
    hashParams: new URLSearchParams(hash),
    searchParams: new URLSearchParams(search),
    hash,
    search,
  };
}

function isRecoveryAuthParams(hashParams, searchParams) {
  return (
    hashParams.get("type") === "recovery" ||
    searchParams.get("type") === "recovery"
  );
}

export function isPasswordRecoveryPending() {
  return sessionStorage.getItem(PASSWORD_RECOVERY_KEY) === "1";
}

export function setPasswordRecoveryPending() {
  sessionStorage.setItem(PASSWORD_RECOVERY_KEY, "1");
}

export function clearPasswordRecoveryPending() {
  sessionStorage.removeItem(PASSWORD_RECOVERY_KEY);
}

function isStaleRefreshTokenError(message) {
  return /refresh token|invalid.*token|session.*not found|jwt expired/i.test(
    String(message || "").toLowerCase()
  );
}

/** Efface une session locale invalide (refresh token révoqué ou absent). */
export async function clearStaleSupabaseSession(error) {
  if (!supabase || !error) return;
  if (!isStaleRefreshTokenError(error.message || error)) return;
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.warn("Supabase clear stale session:", e?.message || e);
  }
}

async function recoverAuthSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("Supabase session:", error.message);
    await clearStaleSupabaseSession(error);
    return null;
  }
  return data.session ?? null;
}

function providerFromUser(user) {
  if (user.app_metadata?.provider === "anonymous") return "guest";
  const p = user.app_metadata?.provider || "email";
  if (p === "facebook") return "facebook";
  if (p === "email") return "email";
  return p;
}

export async function syncSessionToState(session) {
  if (!session?.user) {
    saveStatePatch({
      user: { email: null, name: null, emoji: null, loggedIn: false, isGuest: false, provider: null },
      supabaseUserId: null,
    });
    return;
  }

  const user = session.user;
  const isAnonymous = user.is_anonymous === true;
  let profile = null;

  try {
    profile = await fetchProfile(user.id);
  } catch {
    profile = null;
  }

  const name =
    profile?.display_name ||
    user.user_metadata?.display_name ||
    user.email?.split("@")[0] ||
    "Joueur";

  saveStatePatch({
    supabaseUserId: user.id,
    user: {
      email: user.email || null,
      name,
      emoji: profile?.emoji || user.user_metadata?.emoji || null,
      loggedIn: !isAnonymous,
      isGuest: isAnonymous,
      provider: providerFromUser(user),
    },
  });
}

/** Traite un retour auth (navigateur ou deep link `com.reveal.partygames://…`). */
export async function handleAuthRedirectUrl(rawUrl) {
  if (!isSupabaseConfigured() || !rawUrl) {
    return { handled: false, recovery: false };
  }

  const { hashParams, searchParams, hash, search } = parseAuthParamsFromUrl(rawUrl);
  const authCode = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash") || hashParams.get("token_hash");
  const authType = searchParams.get("type") || hashParams.get("type");
  const hasHashAuth =
    hashParams.get("access_token") ||
    hashParams.get("error_description") ||
    hashParams.get("error");

  if (!hasHashAuth && !authCode && !tokenHash) {
    return { handled: false, recovery: false };
  }

  if (isRecoveryAuthParams(hashParams, searchParams)) {
    setPasswordRecoveryPending();
  }

  if (authCode) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);
    if (error) console.warn("Supabase auth code:", error.message);
    if (data?.session) {
      await syncSessionToState(data.session);
      if (authType === "recovery") setPasswordRecoveryPending();
    }
  } else if (tokenHash && authType) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: authType,
    });
    if (error) console.warn("Supabase verifyOtp:", error.message);
    if (data?.session) {
      await syncSessionToState(data.session);
      if (authType === "recovery") setPasswordRecoveryPending();
    }
  } else if (hasHashAuth) {
    const access_token = hashParams.get("access_token");
    const refresh_token = hashParams.get("refresh_token");
    if (access_token && refresh_token) {
      // App native : les tokens sont dans le deep link, pas dans window.location.
      const { data, error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (error) console.warn("Supabase setSession:", error.message);
      if (data?.session) await syncSessionToState(data.session);
    } else if (!isNativeApp()) {
      const next =
        window.location.pathname +
        (search ? `?${search}` : "") +
        (hash ? `#${hash}` : "");
      window.history.replaceState(null, "", next);
      const { data, error } = await supabase.auth.getSession();
      if (error) console.warn("Supabase auth redirect:", error.message);
      if (data?.session) await syncSessionToState(data.session);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  return {
    handled: true,
    recovery: isPasswordRecoveryPending(),
  };
}

/** Réessaie de traiter l’URL de lancement (deep link) si la session recovery n’est pas encore là. */
export async function reprocessAuthLaunchUrl() {
  if (!isSupabaseConfigured() || !isNativeApp()) return false;
  try {
    const { loadCapacitorApp } = await import("./capacitorImports.js");
    const mod = await loadCapacitorApp();
    const launch = await mod?.App?.getLaunchUrl?.();
    if (!launch?.url) return false;
    await handleAuthRedirectUrl(launch.url);
    const { data } = await supabase.auth.getSession();
    return Boolean(data?.session?.user && !data.session.user.is_anonymous);
  } catch (e) {
    console.warn("REVEAL reprocessAuthLaunchUrl:", e?.message || e);
    return false;
  }
}

/**
 * Session anon minimale pour recovery invité (peek/reclaim membership).
 * Ne pas appeler au boot normal — uniquement dans un flux recovery.
 * @returns {Promise<import("@supabase/supabase-js").Session|null>}
 */
export async function ensureAnonymousSessionForRecovery() {
  if (!isSupabaseConfigured() || !supabase) {
    console.debug("[Lobby Recovery] supabase unavailable");
    return null;
  }

  const stateUser = getState().user;

  // Un vrai compte connecté ne doit jamais être remplacé par une session anon.
  if (stateUser?.loggedIn && stateUser?.isGuest === false) {
    console.debug("[Lobby Recovery] skipped: authenticated user");
    return null;
  }

  // 1) Essayer de restaurer une session existante
  try {
    const session = await recoverAuthSession();

    if (session?.user?.id) {
      await syncSessionToState(session);

      console.debug("[Lobby Recovery] existing session restored", {
        userId: session.user.id,
        anonymous: session.user.is_anonymous ?? false,
      });

      return session;
    }
  } catch (e) {
    console.warn(
      "[Lobby Recovery] restore session failed",
      e.message || e
    );
  }

  // 2) Pas de session -> vérifier qu'on a bien une membership à récupérer
  const membership = loadGuestMembership();

  if (!membership?.membershipId) {
    console.debug("[Lobby Recovery] no guest membership");
    return null;
  }

  console.debug("[Lobby Recovery] creating anonymous session", {
    membershipId: membership.membershipId,
  });

  // 3) Créer une session anon Supabase
  try {
    const { data, error } = await supabase.auth.signInAnonymously();

    if (error) {
      console.warn(
        "[Lobby Recovery] anonymous sign-in failed",
        error.message || error
      );
      return null;
    }

    const nextSession = data?.session ?? null;

    if (!nextSession?.user?.id) {
      console.warn("[Lobby Recovery] no session returned after anon sign-in");
      return null;
    }

    await syncSessionToState(nextSession);

    console.debug("[Lobby Recovery] anonymous session created", {
      userId: nextSession.user.id,
      anonymous: nextSession.user.is_anonymous ?? false,
    });

    return nextSession;

  } catch (e) {
    console.warn(
      "[Lobby Recovery] anonymous sign-in exception",
      e.message || e
    );
    return null;
  }
}

export async function initSupabaseAuth() {
  if (!isSupabaseConfigured()) {
    authInitFinished = true;
    authInitialSessionSeen = true;
    resolveAuthReadyIfComplete("disabled");
    return;
  }

  const windowUrl =
    window.location.href ||
    `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
  await handleAuthRedirectUrl(windowUrl);

  supabase.auth.onAuthStateChange((event, session) => {
    void (async () => {
      await syncSessionToState(session);
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryPending();
      }
      if (event === "INITIAL_SESSION") {
        authInitialSessionSeen = true;
        resolveAuthReadyIfComplete("INITIAL_SESSION");
      }
    })();
  });

  const session = await recoverAuthSession();
  if (session) await syncSessionToState(session);

  authInitFinished = true;
  resolveAuthReadyIfComplete("init");
}

export function getSupabaseUserId() {
  return getState().supabaseUserId || null;
}

export async function signUpWithEmail(email, password, displayName, captchaToken = null) {
  const options = {
    data: { display_name: displayName.trim().slice(0, 24) },
  };
  if (captchaToken) options.captchaToken = captchaToken;

  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options,
  });
  if (error) {
    const msg = formatAuthErrorMessage(error.message);
    return { ok: false, error: msg, captcha: isAuthCaptchaError(error.message) };
  }
  if (data.user) {
    await upsertProfile({
      userId: data.user.id,
      displayName,
      emoji: "👤",
    });
  }
  if (data.session) await syncSessionToState(data.session);
  return { ok: true, loggedIn: Boolean(data.session) };
}

export async function signInWithEmail(email, password, captchaToken = null) {
  const options = {};
  if (captchaToken) options.captchaToken = captchaToken;

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
    options,
  });
  if (error) {
    const msg = formatAuthErrorMessage(error.message);
    return { ok: false, error: msg, captcha: isAuthCaptchaError(error.message) };
  }
  if (data.session) await syncSessionToState(data.session);
  return { ok: true };
}

function guestAuthErrorMessage(error) {
  const msg = error?.message || "";
  if (/anonymous sign-ins are disabled/i.test(msg)) {
    return "Connexion invité désactivée côté Supabase. Dashboard → Authentication → Providers → Anonymous → activer.";
  }
  return formatAuthErrorMessage(msg) || "Connexion invité impossible.";
}

export async function signInAsGuest(displayName, captchaToken = null) {
  const trimmed = String(displayName || "")
    .trim()
    .slice(0, 24);
  if (trimmed.length < 2) {
    return { ok: false, error: "Choisis un pseudo (2 caractères min.)." };
  }

  let session = await recoverAuthSession();
  let user = session?.user ?? null;

  if (user && !user.is_anonymous) {
    return {
      ok: false,
      error: "Tu es connecté avec un compte. Déconnecte-toi pour rejoindre en invité.",
    };
  }

  const hadSession = Boolean(user?.is_anonymous);

  if (!user) {
    const { isTurnstileRequired } = await import("./turnstile.js");
    if (isTurnstileRequired() && !captchaToken) {
      return {
        ok: false,
        error: "Valide la vérification anti-robot.",
        captcha: true,
      };
    }

    const options = {};
    if (captchaToken) options.captchaToken = captchaToken;

    const { data, error } = await supabase.auth.signInAnonymously({ options });
    if (error) {
      return {
        ok: false,
        error: guestAuthErrorMessage(error),
        captcha: isAuthCaptchaError(error.message),
      };
    }
    user = data.user;
    session = data.session;
    if (session) await syncSessionToState(session);
  } else if (session) {
    await syncSessionToState(session);
  }

  if (!user) return { ok: false, error: "Connexion invité impossible." };

  await upsertProfile({
    userId: user.id,
    displayName: trimmed,
    emoji: "🎭",
  });

  saveStatePatch({
    supabaseUserId: user.id,
    user: {
      email: null,
      name: trimmed,
      emoji: "🎭",
      loggedIn: false,
      isGuest: true,
      provider: "guest",
    },
  });

  return { ok: true, hadSession };
}

/** Facebook (Meta) - aussi utilisé pour « Instagram » (OAuth Meta). */
export async function signInWithOAuth(provider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getAuthRedirectUrl(),
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, redirecting: true };
}

export async function signOutSupabase() {
  if (!isSupabaseConfigured()) return;
  await supabase.auth.signOut();
  await syncSessionToState(null);
}

export async function sendPasswordResetEmail(email, captchaToken = null) {
  const trimmed = String(email || "").trim().toLowerCase();
  if (!trimmed) return { ok: false, error: "Email requis." };

  const remaining = getPasswordResetCooldownRemainingMs();
  if (remaining > 0) {
    return {
      ok: false,
      error: passwordResetCooldownMessage(remaining),
      cooldown: true,
    };
  }

  const resetOptions = { redirectTo: getAuthRedirectUrl() };
  if (captchaToken) resetOptions.captchaToken = captchaToken;

  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, resetOptions);
  if (error) {
    if (isAuthRateLimitError(error.message)) {
      markPasswordResetRateLimited();
    }
    return {
      ok: false,
      error: formatAuthErrorMessage(error.message),
      rateLimited: isAuthRateLimitError(error.message),
      captcha: isAuthCaptchaError(error.message),
    };
  }

  markPasswordResetSent();
  return { ok: true };
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
