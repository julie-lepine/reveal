import { getState, saveStatePatch } from "./state.js";

export function adFreeFromProfile(profile) {
  return profile?.ad_free === true;
}

/** Sans pub lié au compte (pas à l’appareil). Invité = toujours false. */
export function isAdFree() {
  const user = getState().user;
  if (!user || user.isGuest) return false;
  return user.adFree === true;
}

export async function refreshAdFreeFromServer() {
  const userId = getState().supabaseUserId;
  const user = getState().user || {};
  if (!userId || user.isGuest) {
    saveStatePatch({ user: { ...user, adFree: false } });
    return false;
  }
  const { fetchProfile } = await import("./supabaseProfile.js");
  const profile = await fetchProfile(userId);
  const adFree = adFreeFromProfile(profile);
  saveStatePatch({ user: { ...getState().user, adFree } });
  return adFree;
}
