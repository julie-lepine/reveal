import { getState, saveStatePatch, renameLocalPlayer, setLocalEmoji } from "./state.js";
import { isSupabaseConfigured } from "./supabaseClient.js";
import {
  signUpWithEmail as sbSignUp,
  signInWithEmail as sbSignIn,
  signInAsGuest as sbGuest,
  signInWithOAuth as sbOAuth,
  signOutSupabase,
  updatePassword,
} from "./supabaseAuth.js";
import { upsertProfile } from "./supabaseProfile.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import {
  registerEmailAccount,
  verifyEmailAccount,
  hasEmailAccount,
  updateEmailAccountName,
  changeEmailAccountPassword,
} from "./authCredentials.js";
import { unsubscribeLobbyRealtime, updateLobbyMemberProfileSupabase } from "./supabaseLobby.js";
import { stopMultiplayerSync } from "./gameSync.js";

export function isLoggedIn() {
  const user = getState().user;
  return Boolean(user?.loggedIn && !user?.isGuest);
}

export function isGuest() {
  return Boolean(getState().user?.isGuest);
}

export function isEmailAccount() {
  const user = getState().user;
  if (isSupabaseConfigured()) {
    return Boolean(user?.loggedIn && !user?.isGuest && user?.provider === "email");
  }
  return Boolean(user?.loggedIn && !user?.isGuest && user?.provider === "email");
}

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

export async function loginWithEmail(email, password) {
  if (isSupabaseConfigured()) {
    return sbSignIn(email, password);
  }

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

export async function signupWithEmail(email, password, name) {
  if (isSupabaseConfigured()) {
    return sbSignUp(email, password, name);
  }

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

/** Facebook OAuth (Meta). Instagram utilise le même fournisseur Meta. */
export async function loginWithSocial(provider) {
  if (isSupabaseConfigured()) {
    if (provider === "instagram") {
      return sbOAuth("facebook");
    }
    if (provider === "facebook") {
      return sbOAuth("facebook");
    }
    return { ok: false, error: "Connexion sociale non disponible." };
  }

  const names = { facebook: "Joueur Facebook", instagram: "Joueur Instagram" };
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

export async function loginAsGuest(displayName) {
  if (isSupabaseConfigured()) {
    return sbGuest(displayName);
  }

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

export async function updateProfileName(name) {
  const res = renameLocalPlayer(name);
  if (!res.ok) return res;

  if (isSupabaseConfigured()) {
    const userId = getSupabaseUserId();
    if (userId) {
      try {
        await upsertProfile({ userId, displayName: res.name, emoji: getState().user?.emoji });
        if (getState().lobby?.id) {
          await updateLobbyMemberProfileSupabase({ displayName: res.name });
        }
      } catch (e) {
        return { ok: false, error: e.message || "Erreur profil." };
      }
    }
    return res;
  }

  const user = getState().user;
  if (user?.provider === "email" && user.email) {
    updateEmailAccountName(user.email, res.name);
  }
  return res;
}

export async function updateProfileEmoji(emoji) {
  const res = setLocalEmoji(emoji);
  if (!res.ok) return res;

  if (isSupabaseConfigured()) {
    const userId = getSupabaseUserId();
    if (userId) {
      try {
        await upsertProfile({
          userId,
          displayName: getState().user?.name || "Joueur",
          emoji: res.emoji,
        });
        if (getState().lobby?.id) {
          await updateLobbyMemberProfileSupabase({ emoji: res.emoji });
        }
      } catch (e) {
        return { ok: false, error: e.message || "Erreur profil." };
      }
    }
  }
  return res;
}

export async function changeEmailPassword(_currentPassword, newPassword) {
  const user = getState().user;
  if (!isEmailAccount() || !user.email) {
    return { ok: false, error: "Réservé aux comptes connectés par email." };
  }

  if (isSupabaseConfigured()) {
    if (!newPassword || newPassword.length < 4) {
      return { ok: false, error: "Le nouveau mot de passe doit faire au moins 4 caractères." };
    }
    return updatePassword(newPassword);
  }

  return changeEmailAccountPassword(user.email, _currentPassword, newPassword);
}

export async function logout() {
  if (isSupabaseConfigured()) {
    stopMultiplayerSync();
    unsubscribeLobbyRealtime();
    await signOutSupabase();
    saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
    return;
  }
  saveStatePatch({
    user: { email: null, name: null, loggedIn: false, isGuest: false, provider: null },
    inLobby: false,
    lobby: null,
    lobbyCode: null,
  });
}
