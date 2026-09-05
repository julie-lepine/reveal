import { getState, saveStatePatch, renameLocalPlayer, setLocalEmoji, setLocalNameColor, setLocalAvatar } from "./state.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";
import {
  signUpWithEmail as sbSignUp,
  signInWithEmail as sbSignIn,
  signInAsGuest as sbGuest,
  signInWithOAuth as sbOAuth,
  signOutSupabase,
  signOutSupabaseAfterAccountDeleted,
  deleteRegisteredAccountOnServer,
  sendPasswordResetEmail as sbSendPasswordResetEmail,
  updatePassword,
  getSupabaseUserId,
  isPasswordRecoveryPending,
  isAuthReadyResolved,
} from "./supabaseAuth.js";
import { upsertProfile } from "./supabaseProfile.js";
import { AVATAR_BUCKET, AVATAR_LABEL } from "../config/signatureAvatar.js";
import { avatarPathForUser } from "./signatureAvatar.js";
import { isPlaceholderDisplayName } from "./profileIdentity.js";
import {
  stopLobbyPresenceSync,
  updateLobbyMemberProfileSupabase,
} from "./supabaseLobby.js";
import { stopMultiplayerSync } from "./gameSync.js";
import { getMembershipSnapshot } from "./lobbyMembershipSnapshot.js";
import { canCreateLobbyFromInputs } from "./lobbyCreateGuard.js";
import { hasActiveLobby } from "./lobby.js";

const BACKEND_REQUIRED =
  "Configuration backend requise. Relance l’application après configuration Supabase.";

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

export function canPlay() {
  const user = getState().user;
  return Boolean(user?.loggedIn || user?.isGuest);
}

export function canCreateLobby() {
  if (!isLoggedIn() || hasActiveLobby()) return false;
  if (!isSupabaseConfigured()) return false;

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

  if (!isSupabaseConfigured()) {
    return { ok: false, error: BACKEND_REQUIRED };
  }

  if (!captchaToken) {
    const { isTurnstileRequired } = await import("./turnstile.js");
    if (isTurnstileRequired()) {
      return { ok: false, error: "Valide la vérification anti-robot.", captcha: true };
    }
  }
  return sbSignIn(email, password, captchaToken);
}

export async function signupWithEmail(email, password, name, captchaToken = null) {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: BACKEND_REQUIRED };
  }

  if (!captchaToken) {
    const { isTurnstileRequired } = await import("./turnstile.js");
    if (isTurnstileRequired()) {
      return { ok: false, error: "Valide la vérification anti-robot.", captcha: true };
    }
  }
  return sbSignUp(email, password, name, captchaToken);
}

export async function requestPasswordReset(email, captchaToken = null) {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: BACKEND_REQUIRED };
  }

  if (!captchaToken) {
    const { isTurnstileRequired } = await import("./turnstile.js");
    if (isTurnstileRequired()) {
      return { ok: false, error: "Valide la vérification anti-robot.", captcha: true };
    }
  }
  return sbSendPasswordResetEmail(email, captchaToken);
}

/** Facebook OAuth (Meta). Instagram utilise le même fournisseur Meta. */
export async function loginWithSocial(provider) {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: BACKEND_REQUIRED };
  }

  if (provider === "instagram") {
    return sbOAuth("facebook");
  }
  if (provider === "facebook") {
    return sbOAuth("facebook");
  }
  return { ok: false, error: "Connexion sociale non disponible." };
}

export async function loginAsGuest(displayName, captchaToken = null, emoji = null) {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: BACKEND_REQUIRED };
  }
  return sbGuest(displayName, captchaToken, emoji);
}

export async function updateProfileName(name) {
  const res = renameLocalPlayer(name);
  if (!res.ok) return res;

  if (!isSupabaseConfigured()) return res;

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

export async function updateProfileEmoji(emoji) {
  const res = setLocalEmoji(emoji);
  if (!res.ok) return res;

  if (!isSupabaseConfigured()) return res;

  const userId = getSupabaseUserId();
  if (userId) {
    try {
      const data = await upsertProfile({
        userId,
        emoji: res.emoji,
      });
      if (data?.emoji) {
        const synced = setLocalEmoji(data.emoji);
        if (!synced.ok) {
          saveStatePatch({
            user: { ...getState().user, emoji: data.emoji },
          });
        }
      }
      if (getState().lobby?.id) {
        await updateLobbyMemberProfileSupabase({
          emoji: data?.emoji || res.emoji,
        });
      }
    } catch (e) {
      return { ok: false, error: e.message || "Erreur profil." };
    }
  }
  return res;
}

export async function updateProfileNameColor(colorId) {
  const res = setLocalNameColor(colorId);
  if (!res.ok) return res;

  if (!isSupabaseConfigured()) return res;

  const userId = getSupabaseUserId();
  if (userId) {
    try {
      await upsertProfile({ userId, nameColor: res.nameColor });
    } catch (e) {
      return { ok: false, error: e.message || "Erreur profil." };
    }
  }
  return res;
}

export async function updateProfileAvatar({ path = null, rev = 0 } = {}) {
  const res = setLocalAvatar({ path, rev });
  if (!res.ok) return res;

  if (!isSupabaseConfigured()) return res;

  const userId = getSupabaseUserId();
  if (userId) {
    try {
      await upsertProfile({
        userId,
        avatarPath: res.avatarPath,
        avatarRev: res.avatarRev,
      });
    } catch (e) {
      return { ok: false, error: e.message || AVATAR_LABEL.error };
    }
  }
  return res;
}

export async function uploadProfileAvatarBlob(blob) {
  const user = getState().user || {};
  if (user.isGuest || user.profilePack !== true) {
    return { ok: false, error: "La photo de profil est incluse dans Signature." };
  }
  if (!blob) return { ok: false, error: AVATAR_LABEL.readError };
  if (!isSupabaseConfigured() || !supabase) {
    return { ok: false, error: BACKEND_REQUIRED };
  }
  const userId = getSupabaseUserId();
  const path = avatarPathForUser(userId);
  if (!path) return { ok: false, error: AVATAR_LABEL.error };

  if (user.avatarPath) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  }

  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "0",
  });
  if (error) return { ok: false, error: error.message || AVATAR_LABEL.error };

  const rev = (Number(user.avatarRev) || 0) + 1;
  return updateProfileAvatar({ path, rev });
}

export async function removeProfileAvatar() {
  const res = await updateProfileAvatar({ path: null, rev: 0 });
  if (!res.ok) return res;
  if (!isSupabaseConfigured() || !supabase) return res;
  const path = avatarPathForUser(getSupabaseUserId());
  if (path) {
    try {
      await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    } catch {
      /* path already null en profil */
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

  if (!isSupabaseConfigured()) {
    return { ok: false, error: BACKEND_REQUIRED };
  }

  if (!newPassword || newPassword.length < 4) {
    return { ok: false, error: "Le nouveau mot de passe doit faire au moins 4 caractères." };
  }
  return updatePassword(newPassword);
}

/**
 * Sortie lobby avant déconnexion / suppression (AUTH-LOGOUT-MEMBER-01).
 * Pas de signOut ici : l'appelant garde la session (JWT) si besoin.
 */
async function leaveActiveLobbyForAuthChange() {
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
      // AUTH-LOGOUT-MEMBER-01 - ne pas signOut si leave non prouvé.
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
            "Impossible de quitter le lobby. Vérifie ta connexion puis réessaie - la déconnexion n'a pas été effectuée pour éviter de bloquer ta place.",
        };
      }
    }
  } else {
    stopMultiplayerSync();
    stopLobbyPresenceSync();
  }
  return { ok: true };
}

export async function logout() {
  if (!isSupabaseConfigured()) {
    saveStatePatch({
      user: {
        email: null,
        name: null,
        loggedIn: false,
        isGuest: false,
        provider: null,
        adFree: false,
        profilePack: false,
        nameColor: null,
        avatarPath: null,
        avatarRev: 0,
      },
      inLobby: false,
      lobby: null,
      lobbyCode: null,
    });
    return { ok: true };
  }

  const leave = await leaveActiveLobbyForAuthChange();
  if (!leave.ok) return leave;
  await signOutSupabase();
  saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
  return { ok: true };
}

/** Compte inscrit uniquement. Confirm UI à la charge de l'écran Paramètres. */
export async function deleteRegisteredAccount() {
  if (!isLoggedIn()) {
    return { ok: false, error: "Aucun compte enregistré à supprimer." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: BACKEND_REQUIRED };
  }

  const leave = await leaveActiveLobbyForAuthChange();
  if (!leave.ok) return leave;

  const server = await deleteRegisteredAccountOnServer();
  if (!server.ok) return server;

  await signOutSupabaseAfterAccountDeleted();
  saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
  return { ok: true };
}
