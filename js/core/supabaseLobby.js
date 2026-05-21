import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getState, saveStatePatch, ensurePlayerScore } from "./state.js";
import { getLocalDisplayName, getLocalEmoji } from "./state.js";
import {
  applyRemoteSession,
  handleSessionRoute,
  startMultiplayerSync,
  refreshGameSession,
  getCachedGameSession,
} from "./gameSync.js";
import { fetchGameSessionByLobby } from "./supabaseGame.js";

const HOST_COLOR = "#A78BFA";
const GUEST_COLOR = "#60A5FA";

let realtimeChannel = null;
const lobbyBundleListeners = new Set();

export function onLobbyBundleUpdated(fn) {
  lobbyBundleListeners.add(fn);
  return () => lobbyBundleListeners.delete(fn);
}

function notifyLobbyBundleUpdated() {
  lobbyBundleListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn("REVEAL lobby listener:", e);
    }
  });
}

function normalizeCode(code) {
  return code.trim().toUpperCase().replace(/\s/g, "");
}

function mapMember(row, currentUserId) {
  return {
    userId: row.user_id,
    name: row.display_name,
    emoji: row.emoji,
    color: row.color,
    ready: Boolean(row.ready),
    isHost: Boolean(row.is_host),
    isLocal: row.user_id === currentUserId,
  };
}

async function fetchLobbyBundle(lobbyId) {
  const userId = getSupabaseUserId();
  const [{ data: lobby, error: lErr }, { data: members, error: mErr }, { data: messages, error: msgErr }] =
    await Promise.all([
      supabase
        .from("lobbies")
        .select("id, code, status, game_id, host_id, nudge_at, nudge_for")
        .eq("id", lobbyId)
        .single(),
      supabase.from("lobby_members").select("*").eq("lobby_id", lobbyId).order("joined_at"),
      supabase
        .from("lobby_messages")
        .select("display_name, body, created_at, user_id")
        .eq("lobby_id", lobbyId)
        .order("created_at", { ascending: true })
        .limit(100),
    ]);

  if (lErr) throw lErr;
  if (mErr) throw mErr;
  if (msgErr) throw msgErr;

  const participants = (members || []).map((m) => mapMember(m, userId));

  return {
    id: lobby.id,
    code: lobby.code,
    status: lobby.status || "waiting",
    gameId: lobby.game_id,
    hostId: lobby.host_id,
    nudgeAt: lobby.nudge_at ? new Date(lobby.nudge_at).getTime() : 0,
    nudgeForUserId: lobby.nudge_for || null,
    participants,
    messages: (messages || []).map((m) => ({
      from: m.display_name,
      text: m.body,
      at: new Date(m.created_at).getTime(),
    })),
  };
}

function applyLobbyToState(bundle) {
  saveStatePatch({
    lobby: {
      id: bundle.id,
      code: bundle.code,
      participants: bundle.participants,
      messages: bundle.messages,
      status: bundle.status,
      gameId: bundle.gameId,
      hostId: bundle.hostId,
      nudgeAt: bundle.nudgeAt || 0,
      nudgeForUserId: bundle.nudgeForUserId || null,
    },
    lobbyCode: bundle.code,
    inLobby: true,
    guessLie: {
      ...getState().guessLie,
      sessionId: bundle.code,
    },
  });
  bundle.participants.forEach((p) => ensurePlayerScore(p.name));
  startMultiplayerSync();
  notifyLobbyBundleUpdated();
}

async function generateUniqueCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const { data } = await supabase.rpc("find_lobby_by_code", { p_code: code });
    if (!data?.length) return code;
  }
  throw new Error("Impossible de générer un code lobby.");
}

export async function createLobbySupabase() {
  const userId = getSupabaseUserId();
  if (!userId) return { ok: false, error: "Connecte-toi pour créer un lobby." };

  const code = await generateUniqueCode();
  const displayName = getLocalDisplayName();
  const emoji = getLocalEmoji();

  const { data: lobby, error: lobbyErr } = await supabase
    .from("lobbies")
    .insert({
      code,
      host_id: userId,
      status: "waiting",
      game_id: null,
    })
    .select("id, code, status, game_id, host_id")
    .single();

  if (lobbyErr) return { ok: false, error: lobbyErr.message };

  const { error: memberErr } = await supabase.from("lobby_members").insert({
    lobby_id: lobby.id,
    user_id: userId,
    display_name: displayName,
    emoji,
    color: HOST_COLOR,
    is_host: true,
    ready: false,
  });

  if (memberErr) return { ok: false, error: memberErr.message };

  const bundle = await fetchLobbyBundle(lobby.id);
  applyLobbyToState(bundle);
  try {
    const gameRow = await fetchGameSessionByLobby(lobby.id);
    if (gameRow) applyRemoteSession(gameRow);
  } catch {
    /* ignore */
  }

  const gs = { ...getState().globalStats };
  gs.lobbiesCreated = (gs.lobbiesCreated || 0) + 1;
  saveStatePatch({ globalStats: gs });

  return { ok: true, code };
}

export async function joinLobbySupabase(codeInput) {
  const userId = getSupabaseUserId();
  if (!userId) return { ok: false, error: "Connecte-toi ou rejoins en invité d'abord." };

  const code = normalizeCode(codeInput);
  if (code.length < 4) return { ok: false, error: "Code invalide." };

  const { data: rows, error: findErr } = await supabase.rpc("find_lobby_by_code", { p_code: code });
  if (findErr) return { ok: false, error: findErr.message };
  const lobbyRow = rows?.[0];
  if (!lobbyRow) {
    return {
      ok: false,
      error: "Code introuvable. Demande le code à l'hôte ou scanne le QR.",
    };
  }

  const { data: existing } = await supabase
    .from("lobby_members")
    .select("id")
    .eq("lobby_id", lobbyRow.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) {
    const { data: memberCount, error: countErr } = await supabase.rpc("get_lobby_member_count", {
      p_lobby_id: lobbyRow.id,
    });
    if (countErr) return { ok: false, error: countErr.message };

    if ((memberCount ?? 0) >= 10) {
      return { ok: false, error: "Le lobby est complet (10 joueurs max)." };
    }

    const { error: joinErr } = await supabase.from("lobby_members").insert({
      lobby_id: lobbyRow.id,
      user_id: userId,
      display_name: getLocalDisplayName(),
      emoji: getLocalEmoji(),
      color: GUEST_COLOR,
      is_host: false,
      ready: false,
    });

    if (joinErr) return { ok: false, error: joinErr.message };

    const gs = { ...getState().globalStats };
    gs.playersJoined = (gs.playersJoined || 0) + 1;
    saveStatePatch({ globalStats: gs });
  }

  const bundle = await fetchLobbyBundle(lobbyRow.id);
  applyLobbyToState(bundle);
  try {
    const gameRow = await fetchGameSessionByLobby(lobbyRow.id);
    if (gameRow) {
      applyRemoteSession(gameRow);
      handleSessionRoute(gameRow);
    }
  } catch {
    /* ignore */
  }
  return { ok: true, code: bundle.code };
}

export async function refreshLobbyFromSupabase() {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return false;
  const bundle = await fetchLobbyBundle(lobbyId);
  applyLobbyToState(bundle);
  return true;
}

/** Quitte le lobby côté serveur (retire le membre local). */
export async function leaveLobbySupabase() {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) return { ok: true };

  const { error } = await supabase
    .from("lobby_members")
    .delete()
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setLocalReadySupabase(ready) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) return;

  const { error } = await supabase
    .from("lobby_members")
    .update({ ready: Boolean(ready) })
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId);

  if (error) throw error;
  await refreshLobbyFromSupabase();
}

/** Hôte : wizz vers les joueurs non prêts (nudge_for null = tous les non-prêts). */
export async function sendLobbyNudgeSupabase(targetUserId = null) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  const isHost = getState().lobby?.participants?.some((p) => p.isLocal && p.isHost);
  if (!lobbyId || !userId || !isHost) {
    return { ok: false, error: "Seul l'hôte peut envoyer un wizz." };
  }

  const { error } = await supabase
    .from("lobbies")
    .update({
      nudge_at: new Date().toISOString(),
      nudge_for: targetUserId,
    })
    .eq("id", lobbyId);

  if (error) return { ok: false, error: error.message };
  await refreshLobbyFromSupabase();
  return { ok: true };
}

export async function updateLobbyMemberProfileSupabase({ displayName, emoji } = {}) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) return;

  const patch = {};
  if (displayName != null) patch.display_name = String(displayName).trim().slice(0, 24);
  if (emoji != null) patch.emoji = emoji;

  if (!Object.keys(patch).length) return;

  const { error } = await supabase
    .from("lobby_members")
    .update(patch)
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId);

  if (error) throw error;
  await refreshLobbyFromSupabase();
}

export async function setLobbyStatusSupabase(status, gameId = null) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return;

  const patch = { status };
  if (gameId !== undefined) patch.game_id = gameId;

  const { error } = await supabase.from("lobbies").update(patch).eq("id", lobbyId);
  if (error) throw error;
  await refreshLobbyFromSupabase();
}

export async function addLobbyMessageSupabase(text) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) return;

  const body = text.trim();
  if (!body) return;

  const { error } = await supabase.from("lobby_messages").insert({
    lobby_id: lobbyId,
    user_id: userId,
    display_name: getLocalDisplayName(),
    body,
  });

  if (error) throw error;
  await refreshLobbyFromSupabase();
}

export function subscribeLobbyRealtime(onUpdate) {
  if (!isSupabaseConfigured()) return () => {};

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return () => {};

  unsubscribeLobbyRealtime();

  realtimeChannel = supabase
    .channel(`lobby:${lobbyId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lobby_members", filter: `lobby_id=eq.${lobbyId}` },
      () => {
        refreshLobbyFromSupabase().then(() => onUpdate?.());
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lobby_messages", filter: `lobby_id=eq.${lobbyId}` },
      () => {
        refreshLobbyFromSupabase().then(() => onUpdate?.());
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` },
      () => {
        refreshLobbyFromSupabase().then(() => onUpdate?.());
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "game_sessions", filter: `lobby_id=eq.${lobbyId}` },
      async (payload) => {
        if (payload.eventType === "DELETE") {
          applyRemoteSession(null);
          onUpdate?.();
          return;
        }
        try {
          await refreshGameSession();
          const row = getCachedGameSession();
          if (row) handleSessionRoute(row);
        } catch (e) {
          console.warn("REVEAL realtime game_sessions:", e.message || e);
        }
        onUpdate?.();
      }
    )
    .subscribe();

  return unsubscribeLobbyRealtime;
}

export function unsubscribeLobbyRealtime() {
  if (realtimeChannel && supabase) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
