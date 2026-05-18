import { getState, saveStatePatch } from "./state.js";

export function isLoggedIn() {
  const user = getState().user;
  return Boolean(user?.loggedIn && !user?.isGuest);
}

export function isGuest() {
  return Boolean(getState().user?.isGuest);
}

/** Compte ou invité avec pseudo */
export function canPlay() {
  const user = getState().user;
  return Boolean(user?.loggedIn || user?.isGuest);
}

export function canCreateLobby() {
  return isLoggedIn();
}

export function getUser() {
  return getState().user;
}

export function loginWithEmail(email, password) {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !password) return { ok: false, error: "Email et mot de passe requis." };
  saveStatePatch({
    user: {
      email: trimmed,
      name: trimmed.split("@")[0],
      loggedIn: true,
      isGuest: false,
      provider: "email",
    },
  });
  return { ok: true };
}

export function signupWithEmail(email, password, name) {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !password || password.length < 4) {
    return { ok: false, error: "Email et mot de passe (4+ caractères) requis." };
  }
  saveStatePatch({
    user: {
      email: trimmed,
      name: (name || trimmed.split("@")[0]).trim(),
      loggedIn: true,
      isGuest: false,
      provider: "email",
    },
  });
  return { ok: true };
}

export function loginWithSocial(provider) {
  const names = { google: "Joueur Google", apple: "Joueur Apple", discord: "Joueur Discord" };
  saveStatePatch({
    user: {
      email: `${provider}@reveal.app`,
      name: names[provider] || "Joueur",
      loggedIn: true,
      isGuest: false,
      provider,
    },
  });
  return { ok: true };
}

/** Invité : pseudo uniquement, pas de compte */
export function loginAsGuest(displayName) {
  const name = displayName.trim().slice(0, 24);
  if (name.length < 2) {
    return { ok: false, error: "Choisis un pseudo (2 caractères min.)." };
  }
  saveStatePatch({
    user: {
      email: null,
      name,
      loggedIn: false,
      isGuest: true,
      provider: "guest",
    },
  });
  return { ok: true };
}

export function logout() {
  saveStatePatch({
    user: { email: null, name: null, loggedIn: false, isGuest: false, provider: null },
    inLobby: false,
  });
}
