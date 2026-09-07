import { getState, saveStatePatch } from "./state.js";
import {
  emptyPremiumFlags,
  mergePremiumSessionFlags,
  normalizePremiumFlags,
} from "./premiumStoreOverlay.js";

/** Overlay session RevenueCat (webhook pending). Jamais écrit en SQL. */
let storePremiumOverlay = emptyPremiumFlags();
let storePremiumOverlayActive = false;
let lastServerPremium = emptyPremiumFlags();

export function adFreeFromProfile(profile) {
  return profile?.ad_free === true;
}

export function profilePackFromProfile(profile) {
  return profile?.profile_pack === true || hostPackFromProfile(profile);
}

export function hostPackFromProfile(profile) {
  return profile?.host_pack === true;
}

/**
 * Flags premium lus depuis une ligne `profiles` (pas d’écriture SQL).
 * `adFree` effectif = colonne `ad_free` ou pack qui l’inclut (Signature / Maître).
 */
export function premiumFlagsFromProfile(profile) {
  const hostPack = hostPackFromProfile(profile);
  const profilePack = profilePackFromProfile(profile);
  const adFree = adFreeFromProfile(profile) || profilePack;
  return { adFree, profilePack, hostPack };
}

/**
 * Sans pub effectif sur un snapshot `user`. Pur : pas de getState.
 * Le filtre invité reste dans `isAdFree()` (comportement pubs inchangé).
 */
export function isAdFreeForUser(user) {
  return user?.adFree === true || user?.profilePack === true || user?.hostPack === true;
}

export function nameColorFromProfile(profile) {
  if (!profilePackFromProfile(profile)) return null;
  const id = profile?.name_color;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function avatarFromProfile(profile) {
  if (!profilePackFromProfile(profile)) return { avatarPath: null, avatarRev: 0 };
  const path = typeof profile?.avatar_path === "string" ? profile.avatar_path.trim() : "";
  return {
    avatarPath: path || null,
    avatarRev: Number(profile?.avatar_rev) > 0 ? Number(profile.avatar_rev) : 0,
  };
}

/** Sans pub lié au compte (pas à l’appareil). Invité = toujours false. Profil / Maître l’incluent. */
export function isAdFree() {
  const user = getState().user;
  if (!user || user.isGuest) return false;
  return isAdFreeForUser(user);
}

/** Pack Profil lié au compte. Invité = toujours false. Maître l’inclut. */
export function isProfilePack() {
  const user = getState().user;
  if (!user || user.isGuest) return false;
  return user.profilePack === true || user.hostPack === true;
}

/** Pack Maître de soirée lié au compte. Invité = toujours false. */
export function isHostPack() {
  const user = getState().user;
  if (!user || user.isGuest) return false;
  return user.hostPack === true;
}

export function getStorePremiumOverlay() {
  return storePremiumOverlayActive ? { ...storePremiumOverlay } : null;
}

export function getLastServerPremium() {
  return { ...lastServerPremium };
}

export function clearStorePremiumOverlay() {
  storePremiumOverlay = emptyPremiumFlags();
  storePremiumOverlayActive = false;
}

export function resetPremiumStoreOverlayForTests() {
  clearStorePremiumOverlay();
  lastServerPremium = emptyPremiumFlags();
}

function applyMergedPremiumToUser(serverFlags, extra = {}) {
  const overlay = storePremiumOverlayActive ? storePremiumOverlay : emptyPremiumFlags();
  const merged = mergePremiumSessionFlags(serverFlags, overlay);
  saveStatePatch({
    user: {
      ...getState().user,
      ...merged,
      ...extra,
    },
  });
  return merged;
}

export async function refreshAdFreeFromServer() {
  const userId = getState().supabaseUserId;
  const user = getState().user || {};
  if (!userId || user.isGuest) {
    clearStorePremiumOverlay();
    lastServerPremium = emptyPremiumFlags();
    saveStatePatch({
      user: {
        ...user,
        adFree: false,
        profilePack: false,
        hostPack: false,
        nameColor: null,
        avatarPath: null,
        avatarRev: 0,
      },
    });
    return false;
  }
  const { fetchProfile } = await import("./supabaseProfile.js");
  const profile = await fetchProfile(userId);
  lastServerPremium = premiumFlagsFromProfile(profile);
  const nameColor = nameColorFromProfile(profile);
  const { avatarPath, avatarRev } = avatarFromProfile(profile);
  const merged = applyMergedPremiumToUser(lastServerPremium, {
    nameColor,
    avatarPath,
    avatarRev,
  });
  return merged.adFree || merged.profilePack || merged.hostPack;
}

/**
 * Overlay session depuis RevenueCat (Play dit déjà acheté, webhook pas encore).
 * N’écrit pas la base. Ne retire pas un flag déjà confirmé serveur.
 */
export function applyPremiumFromStore({ adFree = false, profilePack = false, hostPack = false } = {}) {
  const user = getState().user || {};
  if (!user.loggedIn || user.isGuest) return;
  storePremiumOverlay = normalizePremiumFlags({ adFree, profilePack, hostPack });
  storePremiumOverlayActive = true;
  applyMergedPremiumToUser(lastServerPremium);
}

export async function refreshAdFreeFromServerUntil(expected, opts = {}) {
  const tries = Number(opts.tries) > 0 ? Number(opts.tries) : 6;
  const delayMs = Number(opts.delayMs) > 0 ? Number(opts.delayMs) : 1000;
  let last = false;
  for (let i = 0; i < tries; i++) {
    last = await refreshAdFreeFromServer();
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

export async function refreshProfilePackFromServerUntil(expected, opts = {}) {
  const tries = Number(opts.tries) > 0 ? Number(opts.tries) : 6;
  const delayMs = Number(opts.delayMs) > 0 ? Number(opts.delayMs) : 1000;
  let last = false;
  for (let i = 0; i < tries; i++) {
    await refreshAdFreeFromServer();
    last = isProfilePack();
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

export async function refreshHostPackFromServerUntil(expected, opts = {}) {
  const tries = Number(opts.tries) > 0 ? Number(opts.tries) : 6;
  const delayMs = Number(opts.delayMs) > 0 ? Number(opts.delayMs) : 1000;
  let last = false;
  for (let i = 0; i < tries; i++) {
    await refreshAdFreeFromServer();
    last = isHostPack();
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}
