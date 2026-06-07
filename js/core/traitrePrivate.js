/** Spot the fake — rôle imposteur privé (Supabase RLS ou localStorage hors ligne). */
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
  localStorage.setItem(`${LOCAL_KEY}:${lobbyId}`, JSON.stringify(bundle));
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

/** Hôte : distribue le rôle fake à chaque joueur (table privée / localStorage). */
export async function hostDistributeTraitreRoles(pairId, impostorName, playerNames = []) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId || !pairId || !impostorName) return;

  const names = playerNames.length ? playerNames : [];
  if (!names.length) return;

  if (!isSupabaseConfigured()) {
    const bundle = {};
    names.forEach((name) => {
      const uid = userIdForDisplayName(name) || name;
      bundle[uid] = { pair_id: pairId, is_impostor: name === impostorName };
    });
    writeLocalBundle(lobbyId, bundle);
    return;
  }

  for (const name of names) {
    const uid = userIdForDisplayName(name);
    if (!uid) continue;
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
  }
}

export async function clearTraitrePrivateForLobby(lobbyId) {
  if (!lobbyId) return;
  localStorage.removeItem(`${LOCAL_KEY}:${lobbyId}`);
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.from("traitre_private").delete().eq("lobby_id", lobbyId);
  if (error) console.warn("[traitre_private] clear:", error.message);
}

/** Invité : lit le rôle privé et met à jour traitreGame local. */
export async function syncTraitrePrivateRole(pairId, { notify } = {}) {
  if (!pairId || isLocalLobbyHost()) return;
  const priv = await fetchMyTraitrePrivate(pairId);
  if (!priv) return;

  const session = getState().traitreGame || {};
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
    },
  });
  notify?.();
}
