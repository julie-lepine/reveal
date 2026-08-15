/**
 * Mot privé Draw it ! — table drawit_private (pas traitre_private).
 * localStorage = fallback hors-ligne / recovery, jamais source de vérité MP.
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getState } from "./state.js";

const LOCAL_KEY = "reveal-drawit-private";
const memoryBundles = new Map();

function readLocalBundle(lobbyId) {
  if (typeof localStorage === "undefined") {
    return memoryBundles.get(lobbyId) || null;
  }
  try {
    const raw = localStorage.getItem(`${LOCAL_KEY}:${lobbyId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return memoryBundles.get(lobbyId) || null;
  }
}

function writeLocalBundle(lobbyId, bundle) {
  memoryBundles.set(lobbyId, bundle);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${LOCAL_KEY}:${lobbyId}`, JSON.stringify(bundle));
  } catch {
    /* quota / storage indisponible */
  }
}

export function peekLocalDrawItPrivate(lobbyId, runId, roundIdx) {
  const bundle = readLocalBundle(lobbyId);
  if (!bundle || bundle.runId !== runId) return null;
  const row = bundle.rounds?.[String(roundIdx)] || bundle.rounds?.[roundIdx];
  return row || null;
}

/**
 * Hôte : écrit les mots de toutes les manches (local + RPC si MP).
 * @param {{ runId: string, rounds: Array<{ roundIdx: number, drawerUid: string, wordLabel: string, acceptedAnswers?: string[] }> }} payload
 */
export async function hostWriteDrawItPrivateRounds({ runId, rounds = [] } = {}) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId || !runId) {
    return { ok: false, written: 0, error: "Lobby ou run invalide." };
  }
  const map = {};
  for (const row of rounds) {
    if (row == null || row.roundIdx == null) continue;
    map[String(row.roundIdx)] = {
      runId,
      roundIdx: Number(row.roundIdx),
      drawerUid: String(row.drawerUid || ""),
      wordLabel: String(row.wordLabel || ""),
      acceptedAnswers: Array.isArray(row.acceptedAnswers) ? row.acceptedAnswers : [],
    };
  }
  writeLocalBundle(lobbyId, { runId, rounds: map });

  if (!isSupabaseConfigured()) {
    return { ok: true, written: Object.keys(map).length };
  }

  const { data, error } = await supabase.rpc("write_drawit_private_rounds", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_rounds: rounds.map((r) => ({
      roundIdx: r.roundIdx,
      drawerUid: r.drawerUid,
      wordLabel: r.wordLabel,
      acceptedAnswers: r.acceptedAnswers || [],
    })),
  });
  if (error) {
    console.warn("[drawit_private] write:", error.message);
    return { ok: false, written: 0, error: error.message };
  }
  return { ok: true, written: Number(data) || Object.keys(map).length };
}

/**
 * MP : publie atomiquement les mots privés et la manche 1 horodatée serveur.
 * Le payload public peut contenir des timestamps préparatoires : la RPC les remplace.
 */
export async function hostLaunchDrawItGame({
  publicSession,
  runId,
  rounds = [],
} = {}) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId || !runId || !publicSession) {
    return { ok: false, row: null, error: "Lobby ou lancement invalide." };
  }

  const map = {};
  for (const round of rounds) {
    if (round == null || round.roundIdx == null) continue;
    map[String(round.roundIdx)] = {
      runId,
      roundIdx: Number(round.roundIdx),
      drawerUid: String(round.drawerUid || ""),
      wordLabel: String(round.wordLabel || ""),
      acceptedAnswers: Array.isArray(round.acceptedAnswers)
        ? round.acceptedAnswers
        : [],
    };
  }
  writeLocalBundle(lobbyId, { runId, rounds: map });

  if (!isSupabaseConfigured()) {
    return { ok: true, row: null, written: Object.keys(map).length };
  }

  const payload = rounds.map((round) => ({
    roundIdx: round.roundIdx,
    drawerUid: round.drawerUid,
    wordLabel: round.wordLabel,
    acceptedAnswers: round.acceptedAnswers || [],
  }));
  const { data, error } = await supabase.rpc("launch_drawit_game", {
    p_lobby_id: lobbyId,
    p_drawit: publicSession,
    p_rounds: payload,
  });
  if (error) {
    console.warn("[drawit_private] launch:", error.message);
    return { ok: false, row: null, written: 0, error: error.message };
  }
  return {
    ok: true,
    row: Array.isArray(data) ? data[0] || null : data || null,
    written: Object.keys(map).length,
  };
}

/**
 * Drawer uniquement : relit son mot pour runId + roundIdx courants.
 * Un non-drawer reçoit null (RLS + filtre local).
 */
export async function fetchMyDrawItPrivate(runId, roundIdx) {
  const lobbyId = getState().lobby?.id;
  const uid = getSupabaseUserId();
  if (!lobbyId || !runId || roundIdx == null) return null;

  if (!isSupabaseConfigured()) {
    const row = peekLocalDrawItPrivate(lobbyId, runId, roundIdx);
    if (!row) return null;
    if (uid && row.drawerUid && row.drawerUid !== uid) return null;
    return {
      runId: row.runId,
      roundIdx: row.roundIdx,
      wordLabel: row.wordLabel,
      acceptedAnswers: row.acceptedAnswers || [],
    };
  }

  const { data, error } = await supabase
    .from("drawit_private")
    .select("run_id, round_idx, word_label, accepted_answers, drawer_uid")
    .eq("lobby_id", lobbyId)
    .eq("run_id", runId)
    .eq("round_idx", Number(roundIdx))
    .maybeSingle();
  if (error) {
    console.warn("[drawit_private] fetch:", error.message);
    const row = peekLocalDrawItPrivate(lobbyId, runId, roundIdx);
    if (row && (!uid || !row.drawerUid || row.drawerUid === uid)) {
      return {
        runId: row.runId,
        roundIdx: row.roundIdx,
        wordLabel: row.wordLabel,
        acceptedAnswers: row.acceptedAnswers || [],
      };
    }
    return null;
  }
  if (!data) return null;
  if (uid && data.drawer_uid && data.drawer_uid !== uid) return null;
  return {
    runId: data.run_id,
    roundIdx: data.round_idx,
    wordLabel: data.word_label,
    acceptedAnswers: data.accepted_answers || [],
  };
}
