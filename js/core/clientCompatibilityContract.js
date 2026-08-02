/**
 * ARCH-23 — parsing du contrat serveur de compatibilité (pur).
 */

export const COMPAT_STATUS = Object.freeze({
  COMPATIBLE: "compatible",
  INCOMPATIBLE: "incompatible",
  UNKNOWN: "unknown",
});

/**
 * @param {unknown} data
 * @returns {{ ok: true, minCompatibilityBuild: number, updatedAt?: string|null }
 *   | { ok: false, reason: string }}
 */
export function parseClientCompatibilityConfig(data) {
  if (data == null || typeof data !== "object") {
    return { ok: false, reason: "invalid_payload" };
  }

  const raw =
    data.min_compatibility_build ??
    data.minCompatibilityBuild ??
    data.min_client_compatibility_build;

  if (raw == null) {
    return { ok: false, reason: "floor_absent" };
  }

  if (typeof raw === "string" && raw.trim() === "") {
    return { ok: false, reason: "floor_absent" };
  }

  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "floor_not_number" };
  }
  if (!Number.isInteger(n)) {
    return { ok: false, reason: "floor_not_integer" };
  }
  if (n < 1) {
    return { ok: false, reason: "floor_negative_or_zero" };
  }

  return {
    ok: true,
    minCompatibilityBuild: n,
    updatedAt:
      data.updated_at != null
        ? String(data.updated_at)
        : data.updatedAt != null
          ? String(data.updatedAt)
          : null,
  };
}

/**
 * @param {number} clientBuild
 * @param {number} minBuild
 * @returns {"compatible"|"incompatible"}
 */
export function compareCompatibilityBuilds(clientBuild, minBuild) {
  if (clientBuild >= minBuild) return COMPAT_STATUS.COMPATIBLE;
  return COMPAT_STATUS.INCOMPATIBLE;
}
