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
