/**
 * FEATURE-PROFILE-05 — chemin Storage + URL publique (pas de client Supabase).
 */
import { SUPABASE_URL } from "../config/supabase.js";
import { AVATAR_BUCKET, AVATAR_FILE } from "../config/signatureAvatar.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AVATAR_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/avatar\.jpg$/;

export function avatarPathForUser(userId) {
  const id = String(userId || "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return null;
  return `${id}/${AVATAR_FILE}`;
}

export function sanitizeAvatarPath(path) {
  const raw = typeof path === "string" ? path.trim().toLowerCase() : "";
  return AVATAR_PATH_RE.test(raw) ? raw : null;
}

export function sanitizeAvatarRev(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0 || v > 1e12) return 0;
  return v;
}

export function avatarFieldsFrom(row = {}) {
  return {
    avatarPath: sanitizeAvatarPath(row.avatarPath || row.avatar_path || null),
    avatarRev: sanitizeAvatarRev(row.avatarRev ?? row.avatar_rev),
  };
}

export function publicAvatarUrl(path, rev, baseUrl = SUPABASE_URL) {
  const clean = sanitizeAvatarPath(path);
  const root = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/$/, "") : "";
  if (!clean || !root || root.includes("TON_PROJECT")) return null;
  const url = `${root}/storage/v1/object/public/${AVATAR_BUCKET}/${clean}`;
  const v = sanitizeAvatarRev(rev);
  return v > 0 ? `${url}?v=${v}` : url;
}

export { AVATAR_BUCKET, AVATAR_FILE };
