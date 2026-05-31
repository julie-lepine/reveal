import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

export async function fetchGameSessionByLobby(lobbyId) {
  if (!isSupabaseConfigured() || !lobbyId) return null;
  const { data, error } = await supabase
    .from("game_sessions")
    .select("id, lobby_id, game_id, screen, host_id, state, updated_at")
    .eq("lobby_id", lobbyId)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/**
 * Méta légère (sans le blob `state`) : sert au polling conditionnel.
 * On ne télécharge le `state` complet que si `updated_at` a bougé.
 */
export async function fetchGameSessionMeta(lobbyId) {
  if (!isSupabaseConfigured() || !lobbyId) return null;
  const { data, error } = await supabase
    .from("game_sessions")
    .select("id, screen, game_id, updated_at")
    .eq("lobby_id", lobbyId)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
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
  // On ne re-télécharge PAS `state` ici : l'appelant connaît déjà l'état qu'il
  // vient d'écrire, et le Realtime diffuse la ligne complète aux autres clients.
  const { data, error } = await supabase
    .from("game_sessions")
    .update(patch)
    .eq("lobby_id", lobbyId)
    .select("id, lobby_id, game_id, screen, host_id, updated_at")
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function deleteGameSession(lobbyId) {
  if (!lobbyId) return;
  const { error } = await supabase.from("game_sessions").delete().eq("lobby_id", lobbyId);
  if (error) throw error;
}
