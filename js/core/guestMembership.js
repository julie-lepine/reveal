import { getState } from "./state.js";

const STORAGE_KEY = "reveal-guest-membership";

/**
 * @typedef {{ membershipId: string, lobbyId: string, lobbyCode: string, displayName: string }} GuestMembership
 */

/**
 * @param {GuestMembership | null | undefined} membership
 */
export function saveGuestMembership(membership) {
  if (!membership?.membershipId || !membership?.lobbyId || !membership?.lobbyCode) return;
  const displayName = String(membership.displayName || "").trim();
  if (displayName.length < 2) return;

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        membershipId: membership.membershipId,
        lobbyId: membership.lobbyId,
        lobbyCode: membership.lobbyCode,
        displayName,
      })
    );
  } catch {
    /* quota / storage indisponible */
  }
}

/** @returns {GuestMembership | null} */
export function loadGuestMembership() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.membershipId || !parsed?.lobbyId || !parsed?.lobbyCode) return null;
    const displayName = String(parsed.displayName || "").trim();
    if (displayName.length < 2) return null;
    return {
      membershipId: parsed.membershipId,
      lobbyId: parsed.lobbyId,
      lobbyCode: parsed.lobbyCode,
      displayName,
    };
  } catch {
    return null;
  }
}

export function clearGuestMembership() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage indisponible */
  }
}

/** Invité attendu : ignorer guestMembership pour les comptes email/OAuth connectés. */
export function canUseGuestMembershipRecovery() {
  const user = getState().user;
  if (user?.loggedIn && user?.isGuest === false) return false;
  return Boolean(loadGuestMembership()?.membershipId);
}

/**
 * Extrait l'identité de participation du joueur local depuis un bundle lobby Supabase.
 * @param {{ id?: string, code?: string, participants?: Array<{ isLocal?: boolean, membershipId?: string, name?: string }> } | null | undefined} bundle
 * @returns {GuestMembership | null}
 */
export function membershipFromBundle(bundle) {
  if (!bundle?.id || !bundle?.code) return null;

  const local = (bundle.participants || []).find((p) => p.isLocal);
  if (!local?.membershipId) return null;

  const displayName = String(local.name || "").trim();
  if (displayName.length < 2) return null;

  return {
    membershipId: local.membershipId,
    lobbyId: bundle.id,
    lobbyCode: bundle.code,
    displayName,
  };
}
