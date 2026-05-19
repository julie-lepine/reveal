import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

export async function fetchGameSessionByLobby(lobbyId) {
  if (!isSupabaseConfigured() || !lobbyId) return null;
  const { data, error } = await supabase
    .from("game_sessions")
    .select("id, lobby_id, game_id, screen, host_id, state, updated_at")
    .eq("lobby_id", lobbyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertGameSession({ lobbyId, gameId, screen, hostId, state }) {
  const { data, error } = await supabase
    .from("game_sessions")
    .upsert(
      {
        lobby_id: lobbyId,
        game_id: gameId,
        screen,
        host_id: hostId,
        state: state || {},
      },
      { onConflict: "lobby_id" }
    )
    .select("id, lobby_id, game_id, screen, host_id, state, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function updateGameSession(lobbyId, patch) {
  const { data, error } = await supabase
    .from("game_sessions")
    .update(patch)
    .eq("lobby_id", lobbyId)
    .select("id, lobby_id, game_id, screen, host_id, state, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGameSession(lobbyId) {
  if (!lobbyId) return;
  const { error } = await supabase.from("game_sessions").delete().eq("lobby_id", lobbyId);
  if (error) throw error;
}
