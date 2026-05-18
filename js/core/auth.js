import { getState, saveStatePatch, renameLocalPlayer, setLocalEmoji } from "./state.js";
import {
  registerEmailAccount,
  verifyEmailAccount,
  hasEmailAccount,
  updateEmailAccountName,
  changeEmailAccountPassword,
} from "./authCredentials.js";

export function isLoggedIn() {
  const user = getState().user;
  return Boolean(user?.loggedIn && !user?.isGuest);
}

export function isGuest() {
  return Boolean(getState().user?.isGuest);
}

export function isEmailAccount() {
  const user = getState().user;
  return Boolean(user?.loggedIn && !user?.isGuest && user?.provider === "email");
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

  let check = verifyEmailAccount(trimmed, password);
  if (!check.ok && !hasEmailAccount(trimmed)) {
    const existing = getState().user;
    if (existing?.email === trimmed && existing?.provider === "email") {
      registerEmailAccount(trimmed, password, existing.name || trimmed.split("@")[0]);
      check = verifyEmailAccount(trimmed, password);
    }
  }
  if (!check.ok) return check;

  saveStatePatch({
    user: {
      email: trimmed,
      name: check.name || trimmed.split("@")[0],
      loggedIn: true,
      isGuest: false,
      provider: "email",
    },
  });
  return { ok: true };
}

export function signupWithEmail(email, password, name) {
  const trimmed = email.trim().toLowerCase();
  const displayName = (name || trimmed.split("@")[0]).trim().slice(0, 24);
  if (!trimmed || !password || password.length < 4) {
    return { ok: false, error: "Email et mot de passe (4+ caractères) requis." };
  }
  if (displayName.length < 2) {
    return { ok: false, error: "Choisis un pseudo (2 caractères min.)." };
  }

  if (hasEmailAccount(trimmed)) {
    return { ok: false, error: "Un compte existe déjà pour cet email. Connecte-toi." };
  }

  registerEmailAccount(trimmed, password, displayName);
  saveStatePatch({
    user: {
      email: trimmed,
      name: displayName,
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

export function updateProfileName(name) {
  const res = renameLocalPlayer(name);
  if (!res.ok) return res;

  const user = getState().user;
  if (user?.provider === "email" && user.email) {
    updateEmailAccountName(user.email, res.name);
  }
  return res;
}

export function updateProfileEmoji(emoji) {
  return setLocalEmoji(emoji);
}

export function changeEmailPassword(currentPassword, newPassword) {
  const user = getState().user;
  if (!isEmailAccount() || !user.email) {
    return { ok: false, error: "Réservé aux comptes connectés par email." };
  }
  return changeEmailAccountPassword(user.email, currentPassword, newPassword);
}

export function logout() {
  saveStatePatch({
    user: { email: null, name: null, loggedIn: false, isGuest: false, provider: null },
    inLobby: false,
  });
}
