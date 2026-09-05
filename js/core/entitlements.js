import { getState, saveStatePatch } from "./state.js";

export function adFreeFromProfile(profile) {
  return profile?.ad_free === true;
}

export function profilePackFromProfile(profile) {
  return profile?.profile_pack === true || hostPackFromProfile(profile);
}

export function hostPackFromProfile(profile) {
  return profile?.host_pack === true;
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
  return user.adFree === true || user.profilePack === true || user.hostPack === true;
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

export async function refreshAdFreeFromServer() {
  const userId = getState().supabaseUserId;
  const user = getState().user || {};
  if (!userId || user.isGuest) {
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
  const hostPack = hostPackFromProfile(profile);
  const profilePack = profilePackFromProfile(profile) || hostPack;
  const adFree = adFreeFromProfile(profile) || profilePack;
  const nameColor = nameColorFromProfile(profile);
  const { avatarPath, avatarRev } = avatarFromProfile(profile);
  saveStatePatch({
    user: { ...getState().user, adFree, profilePack, hostPack, nameColor, avatarPath, avatarRev },
  });
  return adFree || profilePack || hostPack;
}

/** Overlay session depuis RevenueCat (Play dit déjà acheté, webhook pas encore). N’écrit pas la base. */
export function applyPremiumFromStore({ adFree = false, profilePack = false, hostPack = false } = {}) {
  const user = getState().user || {};
  if (!user.loggedIn || user.isGuest) return;
  const host = hostPack === true;
  const pack = profilePack === true || host;
  saveStatePatch({
    user: {
      ...getState().user,
      adFree: adFree === true || pack,
      profilePack: pack,
      hostPack: host,
    },
  });
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
