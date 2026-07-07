import { supabase } from "./supabaseClient.js";
import { getState } from "./state.js";

let heartbeatInterval = null;

const HEARTBEAT_INTERVAL = 30_000; // 30 secondes

export function startLobbyHeartbeat() {
  stopLobbyHeartbeat();

  heartbeatInterval = setInterval(async () => {
    const state = getState();

    const lobbyId = state.lobby?.id;
    const userId = state.supabaseUserId;

    if (!lobbyId || !userId) {
      return;
    }

    try {
      const { error } = await supabase
        .from("lobby_members")
        .update({
          last_seen_at: new Date().toISOString()
        })
        .eq("lobby_id", lobbyId)
        .eq("user_id", userId);

      if (error) {
        console.warn("[Heartbeat] update failed", error);
      }

    } catch (err) {
      console.warn("[Heartbeat] error", err);
    }

  }, HEARTBEAT_INTERVAL);
}


export function stopLobbyHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}