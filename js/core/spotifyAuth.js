import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from "../config/spotify.js";

const TOKEN_KEY = "reveal-spotify-token";
const PKCE_VERIFIER_KEY = "reveal-spotify-pkce-verifier";
const SCOPES = "user-library-read";

function normalizeRedirectUri() {
  const host = window.location.hostname;
  const onProd =
    host === "julie-lepine.github.io" &&
    window.location.pathname.replace(/\/$/, "").endsWith("/reveal");
  const configured = SPOTIFY_REDIRECT_URI?.trim();
  if (onProd && configured) {
    return configured.endsWith("/") ? configured : `${configured}/`;
  }
  const base = `${window.location.origin}${window.location.pathname}`;
  return base.endsWith("/") ? base : `${base}/`;
}

function tokenStorageKey() {
  return TOKEN_KEY;
}

function loadTokenBundle() {
  try {
    const raw = localStorage.getItem(tokenStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTokenBundle(bundle) {
  localStorage.setItem(tokenStorageKey(), JSON.stringify(bundle));
}

export function clearSpotifyToken() {
  localStorage.removeItem(tokenStorageKey());
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

function randomVerifier(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

async function exchangeCodeForToken(code, verifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: normalizeRedirectUri(),
    client_id: SPOTIFY_CLIENT_ID,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.error || "SPOTIFY_TOKEN_EXCHANGE_FAILED");
  }
  return res.json();
}

/**
 * Rafraîchissement du token — placeholder prêt pour Edge Function.
 * En client public Spotify, refresh via client_id uniquement.
 */
export async function refreshSpotifyAccessToken() {
  const bundle = loadTokenBundle();
  if (!bundle?.refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: bundle.refreshToken,
    client_id: SPOTIFY_CLIENT_ID,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    clearSpotifyToken();
    return null;
  }

  const data = await res.json();
  const next = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || bundle.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  saveTokenBundle(next);
  return next.accessToken;
}

export function isSpotifyConnected() {
  return Boolean(loadTokenBundle()?.accessToken);
}

export async function getSpotifyAccessToken() {
  const bundle = loadTokenBundle();
  if (!bundle?.accessToken) return null;
  if (bundle.expiresAt && Date.now() < bundle.expiresAt - 60_000) {
    return bundle.accessToken;
  }
  return refreshSpotifyAccessToken();
}

export async function connectSpotify(returnScreen = "playlistguess-prep") {
  if (!SPOTIFY_CLIENT_ID || SPOTIFY_CLIENT_ID === "YOUR_SPOTIFY_CLIENT_ID") {
    throw new Error("SPOTIFY_NOT_CONFIGURED");
  }
  try {
    sessionStorage.setItem("reveal-spotify-return", returnScreen);
  } catch {
    /* ignore */
  }
  const verifier = randomVerifier();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  const challenge = await sha256Base64Url(verifier);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: normalizeRedirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

/** Traite ?code= au retour OAuth (appeler au boot). */
export async function initSpotifyAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");
  if (error) {
    console.warn("Spotify OAuth:", error);
    window.history.replaceState(null, "", window.location.pathname);
    return { ok: false, error };
  }
  if (!code) return { ok: true };

  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  if (!verifier) {
    window.history.replaceState(null, "", window.location.pathname);
    return { ok: false, error: "SPOTIFY_PKCE_MISSING" };
  }

  try {
    const data = await exchangeCodeForToken(code, verifier);
    saveTokenBundle({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    });
    window.history.replaceState(null, "", window.location.pathname);
    return { ok: true, connected: true };
  } catch (e) {
    console.warn("Spotify token exchange:", e);
    window.history.replaceState(null, "", window.location.pathname);
    return { ok: false, error: e.message };
  }
}
