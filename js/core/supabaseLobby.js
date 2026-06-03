import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getState, saveStatePatch, ensurePlayerScore } from "./state.js";
import { getLocalDisplayName, getLocalEmoji } from "./state.js";
import {
  applyRemoteSession,
  handleSessionRoute,
  refreshGameSession,
  getCachedGameSession,
  isActiveGameSessionScreen,
} from "./gameSync.js";
import { getCurrentScreen } from "./router.js";
import { fetchGameSessionByLobby } from "./supabaseGame.js";
import { scalePollIntervalMs } from "../config/syncConfig.js";

const HOST_COLOR = "#A78BFA";
const GUEST_COLOR = "#60A5FA";

let realtimeChannel = null;
let lobbyPresencePollTimer = null;
let presenceLobbyId = null;
let lastLobbyBundleSig = "";
const lobbyBundleListeners = new Set();

/** Signature du lobby : ne notifier (donc re-render) que si quelque chose a réellement changé. */
function lobbyBundleSignature(bundle) {
  return JSON.stringify({
    s: bundle.status,
    g: bundle.gameId,
    n: bundle.nudgeAt,
    nf: bundle.nudgeForUserId,
    p: (bundle.participants || []).map(
      (x) => `${x.userId}:${x.name}:${x.emoji}:${x.ready ? 1 : 0}:${x.isHost ? 1 : 0}`
    ),
    m: (bundle.messages || []).length,
    lm: bundle.messages?.[bundle.messages.length - 1]?.at || 0,
  });
}

function isLobbyGoneError(e) {
  return (
    e?.code === "PGRST116" ||
    String(e?.message || "").includes("0 rows") ||
    String(e?.details || "").includes("0 rows")
  );
}

const DISPLAY_NAME_TAKEN_MSG =
  "Ce pseudo est déjà pris dans ce lobby, choisis-en un autre.";

export function isDuplicateLobbyDisplayNameError(error) {
  const code = error?.code || "";
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    code === "23505" ||
    msg.includes("duplicate key") ||
    msg.includes("unique constraint") ||
    msg.includes("lobby_members_unique_name")
  );
}

/** Vérifie si un pseudo est déjà utilisé dans le lobby (casse ignorée). */
export async function isLobbyDisplayNameTaken(lobbyId, displayName, excludeUserId = null) {
  const trimmed = String(displayName || "").trim();
  if (!lobbyId || trimmed.length < 2) return false;

  let query = supabase
    .from("lobby_members")
    .select("user_id")
    .eq("lobby_id", lobbyId)
    .ilike("display_name", trimmed)
    .limit(1);

  if (excludeUserId) {
    query = query.neq("user_id", excludeUserId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

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

/**
 * Bundle lobby. Par défaut on NE rapatrie PAS les 100 messages (gros poste d'egress) :
 * ils ne changent qu'à l'envoi d'un message, géré séparément (Realtime + envoi).
 * On ne les charge que quand `withMessages` est explicitement demandé.
 */
async function fetchLobbyBundle(lobbyId, { withMessages = false } = {}) {
  const userId = getSupabaseUserId();
  const queries = [
    supabase
      .from("lobbies")
      .select("id, code, status, game_id, host_id, nudge_at, nudge_for")
      .eq("id", lobbyId)
      .single(),
    supabase
      .from("lobby_members")
      .select("user_id, display_name, emoji, color, ready, is_host, joined_at")
      .eq("lobby_id", lobbyId)
      .order("joined_at"),
  ];
  if (withMessages) {
    queries.push(
      supabase
        .from("lobby_messages")
        .select("display_name, body, created_at, user_id")
        .eq("lobby_id", lobbyId)
        .order("created_at", { ascending: true })
        .limit(100)
    );
  }

  const [{ data: lobby, error: lErr }, { data: members, error: mErr }, msgRes] =
    await Promise.all(queries);

  if (lErr) throw lErr;
  if (mErr) throw mErr;
  if (msgRes?.error) throw msgRes.error;

  const participants = (members || []).map((m) => mapMember(m, userId));

  const bundle = {
    id: lobby.id,
    code: lobby.code,
    status: lobby.status || "waiting",
    gameId: lobby.game_id,
    hostId: lobby.host_id,
    nudgeAt: lobby.nudge_at ? new Date(lobby.nudge_at).getTime() : 0,
    nudgeForUserId: lobby.nudge_for || null,
    participants,
  };

  if (withMessages) {
    bundle.messages = (msgRes?.data || []).map((m) => ({
      from: m.display_name,
      text: m.body,
      at: new Date(m.created_at).getTime(),
    }));
  }

  return bundle;
}

function applyLobbyToState(bundle) {
  // Si le bundle n'a pas chargé les messages, on conserve ceux déjà en mémoire.
  const messages =
    bundle.messages !== undefined ? bundle.messages : getState().lobby?.messages || [];

  saveStatePatch({
    lobby: {
      id: bundle.id,
      code: bundle.code,
      participants: bundle.participants,
      messages,
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
  startLobbyPresenceSync();
  const sig = lobbyBundleSignature({ ...bundle, messages });
  if (sig !== lastLobbyBundleSig) {
    lastLobbyBundleSig = sig;
    notifyLobbyBundleUpdated();
  }
}

/** Realtime + polling tant que le joueur est dans un lobby (tous les écrans). */
export function startLobbyPresenceSync() {
  if (!isSupabaseConfigured() || !getState().inLobby || !getState().lobby?.id) return;

  const lobbyId = getState().lobby.id;
  if (presenceLobbyId === lobbyId && realtimeChannel) return;

  stopLobbyPresenceSync();
  presenceLobbyId = lobbyId;

  subscribeLobbyRealtime(() => notifyLobbyBundleUpdated());

  scheduleLobbyPresencePoll();
}

/**
 * Poll de présence auto-planifié. En partie active, on l'espace (le fetch ramène
 * lobby + membres + 100 messages : inutile de marteler ça pendant un jeu, ça
 * contribue aux lags côté hôte). Hors jeu (lobby/menu) on reste réactif.
 */
function scheduleLobbyPresencePoll() {
  if (lobbyPresencePollTimer) clearTimeout(lobbyPresencePollTimer);
  // Le Realtime gère les changements en direct ; ce poll n'est qu'un filet de
  // sécurité (et il ne rapatrie ni les messages ni le `state` du jeu).
  const inGame = isActiveGameSessionScreen(getCurrentScreen());
  const delay = scalePollIntervalMs(inGame ? 20000 : 12000);
  lobbyPresencePollTimer = setTimeout(async () => {
    lobbyPresencePollTimer = null;
    if (typeof document !== "undefined" && document.hidden) {
      if (presenceLobbyId) scheduleLobbyPresencePoll();
      return;
    }
    try {
      await refreshLobbyFromSupabase();
    } catch (e) {
      if (!isLobbyGoneError(e)) {
        console.warn("REVEAL lobby presence poll:", e.message || e);
      }
    }
    if (presenceLobbyId) scheduleLobbyPresencePoll();
  }, delay);
}

export function stopLobbyPresenceSync() {
  presenceLobbyId = null;
  lastLobbyBundleSig = "";
  if (lobbyPresencePollTimer) {
    clearTimeout(lobbyPresencePollTimer);
    lobbyPresencePollTimer = null;
  }
  unsubscribeLobbyRealtime();
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

  const bundle = await fetchLobbyBundle(lobby.id, { withMessages: true });
  applyLobbyToState(bundle);
  const { startMultiplayerSync } = await import("./gameSync.js");
  startMultiplayerSync();
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
      error:
        "Code introuvable. Vérifie le code auprès de l'hôte ou ouvre le lien d'invitation qu'il t'a envoyé.",
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

    const displayName = getLocalDisplayName();
    try {
      if (await isLobbyDisplayNameTaken(lobbyRow.id, displayName)) {
        return {
          ok: false,
          code: "display_name_taken",
          error: DISPLAY_NAME_TAKEN_MSG,
        };
      }
    } catch (e) {
      return { ok: false, error: e.message || "Impossible de vérifier le pseudo." };
    }

    const { error: joinErr } = await supabase.from("lobby_members").insert({
      lobby_id: lobbyRow.id,
      user_id: userId,
      display_name: displayName,
      emoji: getLocalEmoji(),
      color: GUEST_COLOR,
      is_host: false,
      ready: false,
    });

    if (joinErr) {
      if (isDuplicateLobbyDisplayNameError(joinErr)) {
        return {
          ok: false,
          code: "display_name_taken",
          error: DISPLAY_NAME_TAKEN_MSG,
        };
      }
      return { ok: false, error: joinErr.message };
    }

    const gs = { ...getState().globalStats };
    gs.playersJoined = (gs.playersJoined || 0) + 1;
    saveStatePatch({ globalStats: gs });
  }

  const bundle = await fetchLobbyBundle(lobbyRow.id, { withMessages: true });
  applyLobbyToState(bundle);
  const { startMultiplayerSync } = await import("./gameSync.js");
  startMultiplayerSync();
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

export async function refreshLobbyFromSupabase({ withMessages = false } = {}) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return false;
  try {
    const bundle = await fetchLobbyBundle(lobbyId, { withMessages });
    applyLobbyToState(bundle);
    return true;
  } catch (e) {
    if (isLobbyGoneError(e)) {
      const { handleLobbyDissolvedForGuest } = await import("./lobby.js");
      await handleLobbyDissolvedForGuest();
      return false;
    }
    throw e;
  }
}

/** Hôte : supprime le lobby (membres et messages en cascade). */
export async function closeLobbySupabase() {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  const hostId = getState().lobby?.hostId;
  const isHostMember = getState().lobby?.participants?.some((p) => p.isLocal && p.isHost);
  const isHost =
    Boolean(userId && hostId && userId === hostId) ||
    (isHostMember && !hostId);

  if (!lobbyId || !isHost) {
    return { ok: false, error: "Seul l'hôte peut fermer le lobby." };
  }

  try {
    const { deleteGameSession } = await import("./supabaseGame.js");
    await deleteGameSession(lobbyId);
  } catch (e) {
    console.warn("REVEAL delete game session on close lobby:", e.message || e);
  }

  const { data, error } = await supabase.from("lobbies").delete().eq("id", lobbyId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return {
      ok: false,
      error:
        "Le lobby n'a pas pu être supprimé (droits ou session). Reconnecte-toi avec le compte qui a créé la partie.",
    };
  }
  return { ok: true };
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
  if (displayName != null) {
    const trimmed = String(displayName).trim().slice(0, 24);
    if (trimmed.length >= 2) {
      const taken = await isLobbyDisplayNameTaken(lobbyId, trimmed, userId);
      if (taken) throw new Error(DISPLAY_NAME_TAKEN_MSG);
      patch.display_name = trimmed;
    }
  }
  if (emoji != null) patch.emoji = emoji;

  if (!Object.keys(patch).length) return;

  const { error } = await supabase
    .from("lobby_members")
    .update(patch)
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId);

  if (error) {
    if (isDuplicateLobbyDisplayNameError(error)) {
      throw new Error(DISPLAY_NAME_TAKEN_MSG);
    }
    throw error;
  }
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
  await refreshLobbyFromSupabase({ withMessages: true });
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
        refreshLobbyFromSupabase({ withMessages: true }).then(() => onUpdate?.());
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
      { event: "DELETE", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` },
      async () => {
        const { handleLobbyDissolvedForGuest } = await import("./lobby.js");
        await handleLobbyDissolvedForGuest();
        onUpdate?.();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "game_sessions", filter: `lobby_id=eq.${lobbyId}` },
      async (payload) => {
        if (payload.eventType === "DELETE") {
          applyRemoteSession(null);
          refreshLobbyFromSupabase()
            .catch((e) => {
              if (!isLobbyGoneError(e)) {
                console.warn("REVEAL lobby after game_sessions delete:", e.message || e);
              }
            })
            .finally(() => onUpdate?.());
          return;
        }
        try {
          const { pulseGameSessionRealtime } = await import("./gameSync.js");
          pulseGameSessionRealtime();
          /**
           * Le payload Realtime contient déjà la ligne complète (state inclus) :
           * on l'applique directement au lieu de refaire un aller-retour DB. Ça
           * réduit la latence et évite que 6 clients refetchent en même temps.
           */
          if (payload.new && payload.new.state !== undefined) {
            applyRemoteSession(payload.new);
          } else {
            await refreshGameSession();
          }
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
