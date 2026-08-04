/**
 * Ancien canal d’invitation `#join=CODE` (abandonné - saisie manuelle du code uniquement).
 * Ne confond pas avec les hash auth Supabase (`#access_token=…`, `#type=recovery`, …).
 */

export function isLegacyJoinHash(hash = typeof window !== "undefined" ? window.location.hash : "") {
  const raw = String(hash || "").replace(/^#/, "").trim();
  if (!raw) return false;
  if (/^join=/i.test(raw)) return true;
  try {
    return new URLSearchParams(raw).has("join");
  } catch {
    return false;
  }
}

/** Retire uniquement un hash legacy `#join=` ; laisse intact tout autre hash métier. */
export function stripLegacyJoinHashFromLocation() {
  if (typeof window === "undefined" || !isLegacyJoinHash(window.location.hash)) return false;
  if (window.history.replaceState) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return true;
}
