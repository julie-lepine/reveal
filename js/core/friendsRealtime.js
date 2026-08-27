/**
 * FEATURE-FRIENDS-01 Palier 3 — canal Realtime `friends:${userId}`.
 * Pas de topic lobby. Catch-up HTTP coalescé (overlay si lobby, listes toujours).
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getState } from "./state.js";
import { friendsRealtimeTopic } from "../config/friends.js";
import {
  friendsCatchupPlan,
  friendsRealtimeChangeSpecs,
  isRegisteredUser,
} from "./friendsLogic.js";
import { clearFriendsCache } from "./friendsState.js";
import {
  fetchIncomingFriendRequests,
  fetchLobbyFriendOverlay,
  fetchMyFriends,
} from "./supabaseFriends.js";

const CATCHUP_MS = 120;

let channel = null;
let channelUserId = null;
let channelGen = 0;
let catchupTimer = null;

function isLiveFriendsChannel(gen) {
  return gen === channelGen && channel != null;
}

export function stopFriendsRealtime() {
  channelGen += 1;
  if (catchupTimer) {
    clearTimeout(catchupTimer);
    catchupTimer = null;
  }
  if (channel && supabase) {
    try {
      supabase.removeChannel(channel);
    } catch {
      /* already gone */
    }
  }
  channel = null;
  channelUserId = null;
  clearFriendsCache();
}

function scheduleFriendsCatchup(gen) {
  if (catchupTimer) clearTimeout(catchupTimer);
  catchupTimer = setTimeout(() => {
    catchupTimer = null;
    void runFriendsCatchup(gen);
  }, CATCHUP_MS);
}

async function runFriendsCatchup(gen) {
  if (!isLiveFriendsChannel(gen)) return;
  const st = getState();
  const lobbyId = st.lobby?.id || null;
  const plan = friendsCatchupPlan({
    inLobby: Boolean(st.inLobby && lobbyId),
    lobbyId,
  });
  try {
    if (plan.overlay && lobbyId) await fetchLobbyFriendOverlay(lobbyId);
    if (plan.incoming) await fetchIncomingFriendRequests();
    if (plan.friends) await fetchMyFriends();
  } catch (e) {
    console.warn("[FRIENDS-RT] catch-up", e?.message || e);
  }
}

export function startFriendsRealtime(userId) {
  if (!isSupabaseConfigured() || !supabase || !userId) {
    stopFriendsRealtime();
    return;
  }
  if (channel && channelUserId === userId) return;

  stopFriendsRealtime();
  const myGen = ++channelGen;
  channelUserId = userId;
  const topic = friendsRealtimeTopic(userId);
  const ch = supabase.channel(topic);
  channel = ch;

  const onChange = () => {
    if (!isLiveFriendsChannel(myGen)) return;
    scheduleFriendsCatchup(myGen);
  };

  let builder = ch;
  for (const spec of friendsRealtimeChangeSpecs(userId)) {
    builder = builder.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: spec.table,
        filter: spec.filter,
      },
      onChange
    );
  }

  builder.subscribe((status) => {
    if (!isLiveFriendsChannel(myGen)) return;
    if (status === "SUBSCRIBED") scheduleFriendsCatchup(myGen);
  });
}

export function syncFriendsRealtimeForSession() {
  const st = getState();
  const uid = st.supabaseUserId;
  if (isRegisteredUser(st.user) && uid) {
    startFriendsRealtime(uid);
    return;
  }
  stopFriendsRealtime();
}

export function getFriendsRealtimeUserId() {
  return channelUserId;
}
