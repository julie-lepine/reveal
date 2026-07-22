/**
 * I-08 / ARCH-03 — appels RPC game_sessions (pas d'UPDATE libre pour invité / acting).
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

function requireClient() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error("Supabase non configuré.");
  }
}

/** @param {object|null} data */
function asSessionRow(data) {
  if (!data) return null;
  return data;
}

export async function rpcContributeGameSessionPlayer({ lobbyId, game, kind, value }) {
  requireClient();
  const { data, error } = await supabase.rpc("contribute_game_session_player", {
    p_lobby_id: lobbyId,
    p_game: game,
    p_kind: kind,
    p_value: value,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcUpsertPlayerCustomEntry({ lobbyId, game, entry }) {
  requireClient();
  const { data, error } = await supabase.rpc("upsert_player_custom_entry", {
    p_lobby_id: lobbyId,
    p_game: game,
    p_entry: entry,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcDeletePlayerCustomEntry({ lobbyId, game, entryId }) {
  requireClient();
  const { data, error } = await supabase.rpc("delete_player_custom_entry", {
    p_lobby_id: lobbyId,
    p_game: game,
    p_entry_id: entryId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcSubmitTruthMeterAffirmation({ lobbyId, text, authorEstimate }) {
  requireClient();
  const { data, error } = await supabase.rpc("submit_truth_meter_affirmation", {
    p_lobby_id: lobbyId,
    p_text: text,
    p_author_estimate: authorEstimate,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcApplyActingHostPlay({
  lobbyId,
  action,
  game,
  playPatch = {},
  screen = null,
  gameId = null,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("apply_acting_host_play", {
    p_lobby_id: lobbyId,
    p_action: action,
    p_game: game,
    p_play_patch: playPatch,
    p_screen: screen,
    p_game_id: gameId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcCompleteGameSessionAsActor({ lobbyId, screen = "results" }) {
  requireClient();
  const { data, error } = await supabase.rpc("complete_game_session_as_actor", {
    p_lobby_id: lobbyId,
    p_screen: screen,
  });
  if (error) throw error;
  return asSessionRow(data);
}
