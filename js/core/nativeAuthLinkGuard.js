/**
 * Audit liens n°1 : sur l'appli, un lien `com.reveal.partygames://…` portant des
 * jetons de connexion pouvait connecter le téléphone sur n'importe quel compte.
 *
 * Seul lien légitime aujourd'hui : « mot de passe oublié » (la connexion
 * Facebook / Instagram est abandonnée, compte e-mail uniquement). Il n'est
 * accepté que :
 * - sur `com.reveal.partygames://auth/callback` ;
 * - si CE téléphone a demandé la réinitialisation il y a moins d'1 h ;
 * - avec des jetons du compte dont l'adresse a été saisie.
 * Tout autre lien qui ouvrirait une session est refusé.
 * (Si une connexion sociale revient un jour, il faudra l'ajouter ici.)
 *
 * Fonctions pures (stockage et horloge injectables) pour les tests.
 */

import { NATIVE_AUTH_REDIRECT } from "../../data/appConfig.js";

export const NATIVE_AUTH_PENDING_KEY = "reveal-native-auth-pending";

/** Lien « mot de passe oublié » : valable 1 h côté Supabase. */
export const RECOVERY_PENDING_MAX_MS = 60 * 60_000;

function defaultStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Note qu'une réinitialisation a été demandée depuis ce téléphone.
 * @param {{ email: string, now?: number, storage?: Storage|null }} opts
 */
export function markNativeRecoveryPending(opts) {
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
  const email = String(opts.email || "").trim().toLowerCase();
  if (!storage || !email) return;
  try {
    storage.setItem(
      NATIVE_AUTH_PENDING_KEY,
      JSON.stringify({ kind: "recovery", at: opts.now ?? Date.now(), email })
    );
  } catch {
    /* stockage indisponible : le lien sera refusé, l'utilisateur redemande */
  }
}

/** @param {{ storage?: Storage|null }} [opts] */
export function clearNativeAuthPending(opts = {}) {
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
  try {
    storage?.removeItem(NATIVE_AUTH_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** @param {{ storage?: Storage|null }} [opts] */
export function readNativeAuthPending(opts = {}) {
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
  try {
    const raw = storage?.getItem(NATIVE_AUTH_PENDING_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || rec.kind !== "recovery") return null;
    if (!Number.isFinite(rec.at) || !rec.email) return null;
    return rec;
  } catch {
    return null;
  }
}

/** Adresse exacte de retour : `com.reveal.partygames://auth/callback` (+ ?… / #…). */
export function isNativeAuthCallbackUrl(rawUrl) {
  const url = String(rawUrl || "");
  const end = url.search(/[?#]/);
  const base = (end >= 0 ? url.slice(0, end) : url).replace(/\/+$/, "");
  return base.toLowerCase() === NATIVE_AUTH_REDIRECT.toLowerCase();
}

/** Email contenu dans un jeton d'accès (lecture seule, sans vérifier la signature). */
export function emailFromAccessToken(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("binary");
    const json = decodeURIComponent(
      Array.from(binary, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")
    );
    const payload = JSON.parse(json);
    return payload?.email ? String(payload.email).trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Décide si un lien reçu par l'appli peut ouvrir une session.
 * Le mail de réinitialisation (flux implicite) revient avec `#access_token=…&type=recovery`.
 * @param {{
 *   rawUrl: string,
 *   isRecovery: boolean,
 *   accessToken?: string|null,
 *   pending: null | { kind: string, at: number, email?: string|null },
 *   now?: number,
 * }} input
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function evaluateNativeAuthLink({
  rawUrl,
  isRecovery,
  accessToken = null,
  pending,
  now = Date.now(),
}) {
  if (!isNativeAuthCallbackUrl(rawUrl)) return { ok: false, reason: "not_auth_callback" };
  if (!isRecovery) return { ok: false, reason: "not_recovery" };
  if (!accessToken) return { ok: false, reason: "unsupported_flow" };
  if (!pending) return { ok: false, reason: "no_pending_recovery" };

  const age = now - pending.at;
  if (age < 0 || age > RECOVERY_PENDING_MAX_MS) return { ok: false, reason: "pending_expired" };

  const email = emailFromAccessToken(accessToken);
  if (!email || email !== pending.email) return { ok: false, reason: "recovery_email_mismatch" };
  return { ok: true };
}
