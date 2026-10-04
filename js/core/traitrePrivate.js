/** Spot the fake - rôle imposteur privé (Supabase RLS ou localStorage hors ligne). */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getState, saveStatePatch, getLocalDisplayName } from "./state.js";
import { isTraitrePrivateRoleCurrent } from "./sessionMerge.js";

const LOCAL_KEY = "reveal-traitre-private";

function userIdForDisplayName(name) {
  const p = getState().lobby?.participants?.find((x) => x.name === name);
  return p?.userId || null;
}

function localPrivateKeyForName(name) {
  return userIdForDisplayName(name) || name;
}

function isLocalLobbyHost() {
  return Boolean(getState().lobby?.participants?.some((p) => p.isLocal && p.isHost));
}

function readLocalBundle(lobbyId) {
  try {
    const raw = localStorage.getItem(`${LOCAL_KEY}:${lobbyId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalBundle(lobbyId, bundle) {
  try {
    localStorage.setItem(`${LOCAL_KEY}:${lobbyId}`, JSON.stringify(bundle));
  } catch {
    /* quota plein / storage indisponible */
  }
}

/** @returns {{ is_impostor: boolean, pair_id: string } | null} */
export async function fetchMyTraitrePrivate(pairId) {
  const lobbyId = getState().lobby?.id;
  const uid = getSupabaseUserId();
  if (!lobbyId || !uid || !pairId) return null;

  if (!isSupabaseConfigured()) {
    const row = readLocalBundle(lobbyId)[uid];
    if (!row || row.pair_id !== pairId) return null;
    return { is_impostor: Boolean(row.is_impostor), pair_id: row.pair_id };
  }

  const { data, error } = await supabase
    .from("traitre_private")
    .select("is_impostor, pair_id")
    .eq("lobby_id", lobbyId)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) {
    console.warn("[traitre_private]", error.message);
    const row = readLocalBundle(lobbyId)[uid];
    if (row?.pair_id === pairId) {
      return { is_impostor: Boolean(row.is_impostor), pair_id: row.pair_id };
    }
    return null;
  }
  if (!data || data.pair_id !== pairId) return null;
  return { is_impostor: Boolean(data.is_impostor), pair_id: data.pair_id };
}

async function resolvePlayerUid(name) {
  const fromLobby = userIdForDisplayName(name);
  if (fromLobby) return fromLobby;
  const { userIdForName } = await import("./gameSync.js");
  return userIdForName(name) || null;
}

/** Hôte : distribue le rôle fake à chaque joueur (table privée / localStorage). */
export async function hostDistributeTraitreRoles(pairId, impostorName, playerNames = []) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId || !pairId || !impostorName) {
    return { ok: false, written: 0, skippedNames: [], error: "Lobby ou partie invalide." };
  }

  const names = playerNames.length ? playerNames : [];
  if (!names.length) {
    return { ok: false, written: 0, skippedNames: [], error: "Aucun joueur à assigner." };
  }

  if (!isSupabaseConfigured()) {
    const bundle = {};
    names.forEach((name) => {
      const uid = localPrivateKeyForName(name);
      bundle[uid] = { pair_id: pairId, is_impostor: name === impostorName };
    });
    writeLocalBundle(lobbyId, bundle);
    return { ok: true, written: names.length, skippedNames: [] };
  }

  const skippedNames = [];
  let written = 0;
  for (const name of names) {
    const uid = await resolvePlayerUid(name);
    if (!uid) {
      skippedNames.push(name);
      continue;
    }
    const { error } = await supabase.from("traitre_private").upsert(
      {
        lobby_id: lobbyId,
        user_id: uid,
        pair_id: pairId,
        is_impostor: name === impostorName,
      },
      { onConflict: "lobby_id,user_id" }
    );
    if (error) throw error;
    written += 1;
  }

  if (written === 0) {
    return {
      ok: false,
      written: 0,
      skippedNames,
      error:
        "Aucun rôle enregistré - vérifie que traitre-private.sql est appliqué sur Supabase (is_lobby_host via game-sessions-i08-arch03.sql).",
    };
  }

  if (skippedNames.length) {
    return {
      ok: true,
      written,
      skippedNames,
      error: `Rôles partiels : joueurs sans compte (${skippedNames.join(", ")}).`,
    };
  }

  return { ok: true, written, skippedNames: [] };
}

/** E5 dissolve - localStorage seulement (SQL déjà CASCADE sur DELETE lobby). */
export function clearTraitrePrivateLocalForLobby(lobbyId) {
  if (!lobbyId) return;
  localStorage.removeItem(`${LOCAL_KEY}:${lobbyId}`);
}

export async function clearTraitrePrivateForLobby(lobbyId) {
  if (!lobbyId) return;
  clearTraitrePrivateLocalForLobby(lobbyId);
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.from("traitre_private").delete().eq("lobby_id", lobbyId);
  if (error) console.warn("[traitre_private] clear:", error.message);
}

function applyTraitrePrivateRole(session, priv, expectedNonce) {
  const current = getState().traitreGame || session || {};
  const currentPairId = current.pairId || null;
  if (!priv || (priv.is_impostor !== true && priv.is_impostor !== false)) return false;
  if (!priv.pair_id || priv.pair_id !== currentPairId) return false;
  if ((current.privateRoleNonce ?? 0) !== expectedNonce) return false;
  if (isTraitrePrivateRoleCurrent(current)) return true;

  const isLocalImpostor = priv.is_impostor === true;
  const revealed = Boolean(current.impostorRevealed);
  const impostorName = revealed
    ? current.impostorName
    : isLocalImpostor
      ? getLocalDisplayName()
      : null;

  saveStatePatch({
    traitreGame: {
      ...current,
      isLocalImpostor,
      impostorName,
      privateRoleSynced: true,
      privateRolePairId: currentPairId,
      privateRoleNonce: expectedNonce,
    },
  });
  return true;
}

/** Invité : lit le rôle privé et met à jour traitreGame local (retry si distribution en cours). */
export async function syncTraitrePrivateRole(
  pairId,
  { notify, maxAttempts = 6, delayMs = 400 } = {}
) {
  if (!pairId || isLocalLobbyHost()) return true;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const live = getState().traitreGame || {};
    if ((live.pairId || null) !== pairId) return false;
    if (isTraitrePrivateRoleCurrent(live)) return true;

    // Nonce = contexte de deal au lancement du fetch, pas « aucun merge depuis ».
    // Un snapshot du même deal ne l'avance pas. Un autre deal / une autre partie oui.
    const nonce = live.privateRoleNonce ?? 0;
    const priv = await fetchMyTraitrePrivate(pairId);
    const after = getState().traitreGame || {};
    if ((after.pairId || null) !== pairId) return false;
    if ((after.privateRoleNonce ?? 0) !== nonce) {
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      continue;
    }

    if (priv?.pair_id === pairId && applyTraitrePrivateRole(after, priv, nonce)) {
      notify?.();
      return true;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}
