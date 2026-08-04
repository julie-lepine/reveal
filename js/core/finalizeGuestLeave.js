/**
 * Finalisation guest après leave serveur autoritativement prouvé.
 * Ne wipe pas le cache lobby, ne navigue pas - responsabilité de l'orchestrateur.
 *
 * Invariant ordre :
 * 1) signOut anon si besoin (utilise wasGuest capturé + getUser is_anonymous)
 * 2) clear hint `reveal-guest-membership`
 * CANONICAL_ELSEWHERE → no-op (session + hint utiles pour recover Y).
 */
export async function finalizeGuestAfterAuthoritativeLeave(ctx = {}, deps) {
  if (!deps?.signOutAnonGuestIfNeeded || !deps?.clearGuestMembership) {
    throw new Error("finalizeGuestAfterAuthoritativeLeave: deps required");
  }

  if (ctx.canonicalElsewhere) {
    return { ok: true, skipped: true, reason: "canonical_elsewhere" };
  }

  if (!ctx.skipAnonSignOut) {
    await deps.signOutAnonGuestIfNeeded(Boolean(ctx.wasGuest));
  }
  deps.clearGuestMembership();
  return { ok: true };
}
