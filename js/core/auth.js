import { getState, saveStatePatch, renameLocalPlayer, setLocalEmoji } from "./state.js";
import { isSupabaseConfigured } from "./supabaseClient.js";
import {
  signUpWithEmail as sbSignUp,
  signInWithEmail as sbSignIn,
  signInAsGuest as sbGuest,
  signInWithOAuth as sbOAuth,
  signOutSupabase,
  sendPasswordResetEmail as sbSendPasswordResetEmail,
  updatePassword,
  getSupabaseUserId,
  isPasswordRecoveryPending,
  isAuthReadyResolved,
} from "./supabaseAuth.js";
import { upsertProfile } from "./supabaseProfile.js";
import {
  registerEmailAccount,
  verifyEmailAccount,
  hasEmailAccount,
  updateEmailAccountName,
  changeEmailAccountPassword,
} from "./authCredentials.js";
import {
  stopLobbyPresenceSync,
  updateLobbyMemberProfileSupabase,
} from "./supabaseLobby.js";
import { stopMultiplayerSync } from "./gameSync.js";
import { normalizeGuestEmoji } from "../../data/profileEmojis.js";
import { getMembershipSnapshot } from "./lobbyMembershipSnapshot.js";
import { canCreateLobbyFromInputs } from "./lobbyCreateGuard.js";
import { hasActiveLobby } from "./lobby.js";

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
  if (!isLoggedIn() || hasActiveLobby()) return false;

  // Offline / demo : pas de snapshot membership — inchangé.
  if (!isSupabaseConfigured()) return true;

  // Synchrone : snapshot none frais requis. L’INSERT re-query toujours (Vague C).
  if (!isAuthReadyResolved()) return false;

  const snapshot = getMembershipSnapshot();
  return canCreateLobbyFromInputs({
    loggedIn: true,
    hasActiveLobby: false,
    authReady: true,
    supabaseConfigured: true,
    snapshot,
  });
}

export function getUser() {
  return getState().user;
}

export async function loginWithEmail(email, password, captchaToken = null) {
  if (!email?.trim()) {
    return { ok: false, error: "Indique ton email pour te connecter." };
  }
  if (!password) {
    return { ok: false, error: "Indique ton mot de passe." };
  }

  if (isSupabaseConfigured()) {
    if (!captchaToken) {
      const { isTurnstileRequired } = await import("./turnstile.js");
      if (isTurnstileRequired()) {
        return { ok: false, error: "Valide la vérification anti-robot.", captcha: true };
      }
    }
    return sbSignIn(email, password, captchaToken);
  }

  const trimmed = email.trim().toLowerCase();

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

export async function signupWithEmail(email, password, name, captchaToken = null) {
  if (isSupabaseConfigured()) {
    if (!captchaToken) {
      const { isTurnstileRequired } = await import("./turnstile.js");
      if (isTurnstileRequired()) {
        return { ok: false, error: "Valide la vérification anti-robot.", captcha: true };
      }
    }
    return sbSignUp(email, password, name, captchaToken);
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

export async function requestPasswordReset(email, captchaToken = null) {
  if (isSupabaseConfigured()) {
    if (!captchaToken) {
      const { isTurnstileRequired } = await import("./turnstile.js");
      if (isTurnstileRequired()) {
        return { ok: false, error: "Valide la vérification anti-robot.", captcha: true };
      }
    }
    return sbSendPasswordResetEmail(email, captchaToken);
  }
  return {
    ok: false,
    error:
      "Réinitialisation par email indisponible en mode démo local. Connecte-toi puis change ton mot de passe dans Paramètres, ou réinitialise l’app.",
  };
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

export async function loginAsGuest(displayName, captchaToken = null, emoji = null) {
  if (isSupabaseConfigured()) {
    return sbGuest(displayName, captchaToken, emoji);
  }

  const name = displayName.trim().slice(0, 24);
  if (name.length < 2) {
    return { ok: false, error: "Choisis un pseudo (2 caractères min.)." };
  }
  const chosenEmoji = normalizeGuestEmoji(emoji);
  saveStatePatch({
    user: {
      email: null,
      name,
      emoji: chosenEmoji,
      loggedIn: false,
      isGuest: true,
      provider: "guest",
    },
  });
  return { ok: true, hadSession: false };
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
  const recoveryFlow = isPasswordRecoveryPending();
  if (!recoveryFlow && (!isEmailAccount() || !user.email)) {
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
    const { hasActiveLobby, leaveLobby, confirmAndLeaveLobby } = await import("./lobby.js");
    const { isLobbyHost } = await import("./gameSync.js");
    if (hasActiveLobby()) {
      if (isLobbyHost()) {
        const res = await confirmAndLeaveLobby({ navigateAway: false });
        if (res.cancelled) {
          return { ok: false, cancelled: true };
        }
        if (!res.ok) {
          return { ok: false, error: res.error || "Impossible de fermer le lobby." };
        }
      } else {
        // AUTH-LOGOUT-MEMBER-01 — ne pas signOut si leave non prouvé.
        // Feedback UX : propriétaire = caller (home #btn-logout) via res.error.
        let res;
        try {
          res = await leaveLobby({ navigateAway: false });
        } catch (e) {
          return {
            ok: false,
            error:
              "La connexion a empêché la sortie du lobby. Réessaie avant de te déconnecter.",
          };
        }
        if (res?.cancelled) {
          return { ok: false, cancelled: true };
        }
        if (!res || res.ok !== true) {
          return {
            ok: false,
            error:
              res?.error ||
              "Impossible de quitter le lobby. Vérifie ta connexion puis réessaie — la déconnexion n'a pas été effectuée pour éviter de bloquer ta place.",
          };
        }
      }
    } else {
      stopMultiplayerSync();
      stopLobbyPresenceSync();
    }
    await signOutSupabase();
    saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
    return { ok: true };
  }
  saveStatePatch({
    user: { email: null, name: null, loggedIn: false, isGuest: false, provider: null },
    inLobby: false,
    lobby: null,
    lobbyCode: null,
  });
  return { ok: true };
}
