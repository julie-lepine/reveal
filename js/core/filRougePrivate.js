/** MOT INTERDIT (Fil Rouge) - missions privées Supabase ; voir data/filRouge.js */
import { FIL_ROUGE_ENABLED } from "../../data/filRouge.js";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getState } from "./state.js";

const LOCAL_KEY = "reveal-fil-rouge-private";

function localStoreKey(lobbyId, userId) {
  return `${LOCAL_KEY}:${lobbyId}:${userId}`;
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

export async function fetchMyFilRougePrivate() {
  if (!FIL_ROUGE_ENABLED) return null;
  const lobbyId = getState().lobby?.id;
  const uid = getSupabaseUserId();
  if (!lobbyId || !uid) return null;

  if (!isSupabaseConfigured()) {
    const bundle = readLocalBundle(lobbyId);
    return bundle[uid] || null;
  }

  const { data, error } = await supabase
    .from("fil_rouge_private")
    .select(
      "id, lobby_id, user_id, setup_word, mission_word, mission_target_uid, mission_ack_at"
    )
    .eq("lobby_id", lobbyId)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) {
    console.warn("[fil_rouge_private]", error.message);
    const bundle = readLocalBundle(lobbyId);
    return bundle[uid] || null;
  }
  return data;
}

/** Hôte : toutes les lignes du lobby (distribution). */
export async function fetchAllFilRougePrivateForLobby() {
  if (!FIL_ROUGE_ENABLED) return [];
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return [];

  if (!isSupabaseConfigured()) {
    const bundle = readLocalBundle(lobbyId);
    return Object.entries(bundle).map(([userId, row]) => ({ user_id: userId, ...row }));
  }

  const { data, error } = await supabase
    .from("fil_rouge_private")
    .select(
      "id, lobby_id, user_id, setup_word, mission_word, mission_target_uid, mission_ack_at"
    )
    .eq("lobby_id", lobbyId);
  if (error) throw error;
  return data || [];
}

export async function upsertMyFilRougeSetupWord(setupWord) {
  if (!FIL_ROUGE_ENABLED) return null;
  const lobbyId = getState().lobby?.id;
  const uid = getSupabaseUserId();
  if (!lobbyId || !uid) return null;

  if (!isSupabaseConfigured()) {
    const bundle = readLocalBundle(lobbyId);
    bundle[uid] = { ...(bundle[uid] || {}), setup_word: setupWord };
    writeLocalBundle(lobbyId, bundle);
    return bundle[uid];
  }

  const { data, error } = await supabase
    .from("fil_rouge_private")
    .upsert(
      { lobby_id: lobbyId, user_id: uid, setup_word: setupWord },
      { onConflict: "lobby_id,user_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function ackMyFilRougeMission() {
  if (!FIL_ROUGE_ENABLED) return;
  const lobbyId = getState().lobby?.id;
  const uid = getSupabaseUserId();
  if (!lobbyId || !uid) return;

  const ackAt = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    const bundle = readLocalBundle(lobbyId);
    if (bundle[uid]) {
      bundle[uid].mission_ack_at = ackAt;
      writeLocalBundle(lobbyId, bundle);
    }
    return;
  }

  const { error } = await supabase
    .from("fil_rouge_private")
    .update({ mission_ack_at: ackAt })
    .eq("lobby_id", lobbyId)
    .eq("user_id", uid);
  if (error) throw error;
}

/** Hôte : écrit les missions sur chaque ligne. */
export async function hostDistributeFilRougeMissions(assignments) {
  if (!FIL_ROUGE_ENABLED) return;
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return;

  if (!isSupabaseConfigured()) {
    const bundle = readLocalBundle(lobbyId);
    assignments.forEach(({ agentUid, missionWord, missionTargetUid }) => {
      bundle[agentUid] = {
        ...(bundle[agentUid] || {}),
        mission_word: missionWord,
        mission_target_uid: missionTargetUid,
        mission_ack_at: null,
      };
    });
    writeLocalBundle(lobbyId, bundle);
    return;
  }

  for (const a of assignments) {
    const { error } = await supabase
      .from("fil_rouge_private")
      .update({
        mission_word: a.missionWord,
        mission_target_uid: a.missionTargetUid,
        mission_ack_at: null,
      })
      .eq("lobby_id", lobbyId)
      .eq("user_id", a.agentUid);
    if (error) throw error;
  }
}

export async function clearFilRougePrivateForLobby(lobbyId) {
  if (!FIL_ROUGE_ENABLED) return;
  if (!lobbyId) return;
  localStorage.removeItem(`${LOCAL_KEY}:${lobbyId}`);
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.from("fil_rouge_private").delete().eq("lobby_id", lobbyId);
  if (error) throw error;
}
