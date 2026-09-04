import { getState, saveStatePatch } from "./state.js";

export function adFreeFromProfile(profile) {
  return profile?.ad_free === true;
}

export function profilePackFromProfile(profile) {
  return profile?.profile_pack === true;
}

/** Sans pub lié au compte (pas à l’appareil). Invité = toujours false. Profil l’inclut. */
export function isAdFree() {
  const user = getState().user;
  if (!user || user.isGuest) return false;
  return user.adFree === true || user.profilePack === true;
}

/** Pack Profil lié au compte. Invité = toujours false. */
export function isProfilePack() {
  const user = getState().user;
  if (!user || user.isGuest) return false;
  return user.profilePack === true;
}

export async function refreshAdFreeFromServer() {
  const userId = getState().supabaseUserId;
  const user = getState().user || {};
  if (!userId || user.isGuest) {
    saveStatePatch({ user: { ...user, adFree: false, profilePack: false } });
    return false;
  }
  const { fetchProfile } = await import("./supabaseProfile.js");
  const profile = await fetchProfile(userId);
  const adFree = adFreeFromProfile(profile);
  const profilePack = profilePackFromProfile(profile);
  saveStatePatch({ user: { ...getState().user, adFree, profilePack } });
  return adFree || profilePack;
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
