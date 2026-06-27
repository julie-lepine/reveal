/** Spot the fake - rôle imposteur privé (Supabase RLS ou localStorage hors ligne). */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getState, saveStatePatch, getLocalDisplayName } from "./state.js";

const LOCAL_KEY = "reveal-traitre-private";

function userIdForDisplayName(name) {
  const p = getState().lobby?.participants?.find((x) => x.name === name);
  return p?.userId || null;
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
      const uid = userIdForDisplayName(name) || name;
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
        "Aucun rôle enregistré - vérifie que fil-rouge-private.sql et traitre-private.sql sont appliqués sur Supabase.",
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

export async function clearTraitrePrivateForLobby(lobbyId) {
  if (!lobbyId) return;
  localStorage.removeItem(`${LOCAL_KEY}:${lobbyId}`);
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.from("traitre_private").delete().eq("lobby_id", lobbyId);
  if (error) console.warn("[traitre_private] clear:", error.message);
}

function applyTraitrePrivateRole(session, priv) {
  const isLocalImpostor = Boolean(priv.is_impostor);
  const revealed = Boolean(session.impostorRevealed);
  const impostorName = revealed
    ? session.impostorName
    : isLocalImpostor
      ? getLocalDisplayName()
      : null;

  saveStatePatch({
    traitreGame: {
      ...session,
      isLocalImpostor,
      impostorName,
      privateRoleSynced: true,
    },
  });
}

/** Invité : lit le rôle privé et met à jour traitreGame local (retry si distribution en cours). */
export async function syncTraitrePrivateRole(
  pairId,
  { notify, maxAttempts = 6, delayMs = 400 } = {}
) {
  if (!pairId || isLocalLobbyHost()) return true;

  const session = getState().traitreGame || {};
  if (session.privateRoleSynced) return true;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const priv = await fetchMyTraitrePrivate(pairId);
    if (priv) {
      applyTraitrePrivateRole(getState().traitreGame || {}, priv);
      notify?.();
      return true;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}
