/**
 * Vague 2 — wrappers RPC sondages.
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
export {
  extractLobbyPollErrorCode,
  lobbyPollErrorMessage,
  formatLobbyPollRpcError,
} from "./lobbyPollErrors.js";
import { formatLobbyPollRpcError } from "./lobbyPollErrors.js";

function requireClient() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error("Supabase non configuré.");
  }
}

export async function rpcCreateLobbyPoll({ lobbyId, options }) {
  requireClient();
  const { data, error } = await supabase.rpc("create_lobby_poll", {
    p_lobby_id: lobbyId,
    p_options: options,
  });
  if (error) throw error;
  return data;
}

export async function rpcCastLobbyPollVote({ pollId, gameId }) {
  requireClient();
  const { data, error } = await supabase.rpc("cast_lobby_poll_vote", {
    p_poll_id: pollId,
    p_game_id: gameId,
  });
  if (error) throw error;
  return data;
}

/** Vague 2 : reason = explicit uniquement côté UI. */
export async function rpcCloseLobbyPoll({ pollId, reason = "explicit" }) {
  requireClient();
  if (reason !== "explicit" && reason !== "launch") {
    throw new Error("poll_close_invalid_reason");
  }
  const { data, error } = await supabase.rpc("close_lobby_poll", {
    p_poll_id: pollId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function fetchOpenLobbyPoll(lobbyId) {
  requireClient();
  const { data, error } = await supabase
    .from("lobby_polls")
    .select("id, lobby_id, created_by, status, options, closed_reason, created_at, closed_at")
    .eq("lobby_id", lobbyId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function fetchLobbyPollVotes(pollId) {
  requireClient();
  const { data, error } = await supabase
    .from("lobby_poll_votes")
    .select("id, poll_id, user_id, game_id, created_at, updated_at")
    .eq("poll_id", pollId);
  if (error) throw error;
  return data || [];
}
