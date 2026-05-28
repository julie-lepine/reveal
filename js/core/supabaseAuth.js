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

const PASSWORD_RECOVERY_KEY = "reveal-pending-password-reset";

function redirectUrl() {
  const base = window.location.origin + window.location.pathname;
  return base.replace(/\/$/, "") || base;
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

function isRecoveryAuthParams(hashParams, searchParams) {
  return (
    hashParams.get("type") === "recovery" ||
    searchParams.get("type") === "recovery"
  );
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

export async function initSupabaseAuth() {
  if (!isSupabaseConfigured()) return;

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  if (isRecoveryAuthParams(hashParams, searchParams)) {
    setPasswordRecoveryPending();
  }

  if (hashParams.get("access_token") || hashParams.get("error_description")) {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn("Supabase auth redirect:", error.message);
    if (data.session) await syncSessionToState(data.session);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) await syncSessionToState(data.session);

  supabase.auth.onAuthStateChange((event, session) => {
    syncSessionToState(session);
    if (event === "PASSWORD_RECOVERY") {
      setPasswordRecoveryPending();
    }
  });
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
  return msg || "Connexion invité impossible.";
}

export async function signInAsGuest(displayName) {
  const trimmed = String(displayName || "")
    .trim()
    .slice(0, 24);
  if (trimmed.length < 2) {
    return { ok: false, error: "Choisis un pseudo (2 caractères min.)." };
  }

  const { data: existing } = await supabase.auth.getSession();
  let session = existing?.session ?? null;
  let user = session?.user ?? null;

  if (user && !user.is_anonymous) {
    return {
      ok: false,
      error: "Tu es connecté avec un compte. Déconnecte-toi pour rejoindre en invité.",
    };
  }

  if (!user) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) return { ok: false, error: guestAuthErrorMessage(error) };
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

  return { ok: true };
}

/** Facebook (Meta) - aussi utilisé pour « Instagram » (OAuth Meta). */
export async function signInWithOAuth(provider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: redirectUrl(),
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

  const resetOptions = { redirectTo: redirectUrl() };
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
