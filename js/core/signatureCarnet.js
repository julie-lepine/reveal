/**
 * FEATURE-PROFILE-04 — archive / lecture du carnet Signature.
 * Pas d’import statique de lobby.js (cycle).
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { isLoggedIn, isGuest } from "./auth.js";
import { isProfilePack } from "./entitlements.js";
import {
  getLocalDisplayName,
  getState,
  hasEveningStatsActivity,
} from "./state.js";
import { buildEveningStandingPlayers } from "./eveningStandings.js";
import { sortAndRankByScore } from "./competitionRank.js";
import { resolveEveningGameScoreOrder } from "./gameScoreOrder.js";
import {
  buildSignatureEveningPayload,
  parseCarnetListPayload,
} from "./signatureCarnetLogic.js";
import { isRegisteredUser } from "./friendsLogic.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { setSignatureEveningArchiveDraftListener } from "./state.js";
import {
  clearSignatureEveningArchiveDraft,
  inspectSignatureEveningArchiveDraft,
  saveSignatureEveningArchiveDraft,
} from "./signatureCarnetDraftStore.js";
import { payloadFromSignatureCarnetDraft } from "./signatureCarnetDraftLogic.js";

const SILENT_ARCHIVE_CODES = new Set([
  "signature_locked",
  "signature_empty",
  "signature_not_member",
  "friends_guest",
  "PGRST202",
]);

function canCallCarnetRpc() {
  return Boolean(
    isSupabaseConfigured() && supabase && isRegisteredUser(getState().user)
  );
}

function rpcCode(error) {
  const raw = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    typeof error === "string" ? error : "",
  ]
    .filter(Boolean)
    .join(" ");
  for (const code of [
    "signature_locked",
    "signature_empty",
    "signature_not_member",
    "friends_guest",
    "PGRST202",
  ]) {
    if (raw.includes(code)) return code;
  }
  return error?.code || null;
}

function resolveLobbyDisplayName(key, participants) {
  if (key == null || key === "") return null;
  const raw = String(key);
  const ps = participants || [];
  const byUid = ps.find((p) => p.userId && String(p.userId) === raw);
  if (byUid?.name) return byUid.name;
  const byName = ps.find((p) => p.name === raw);
  if (byName) return raw;
  return null;
}

export function collectSignatureEveningArchivePayload() {
  if (!isProfilePack() || isGuest() || !isLoggedIn()) return null;
  const state = getState();
  const lobby = state.lobby;
  const lobbyId = lobby?.id || null;
  if (!lobbyId || !hasEveningStatsActivity()) return null;

  const participants = Array.isArray(lobby?.participants) ? lobby.participants : [];
  const activePlayers = participants.map((p) => ({
    name: p.name,
    userId: p.userId || null,
    color: p.color,
    emoji: p.emoji,
    nameColor: p.nameColor || null,
    signature: Boolean(p.signature),
    avatarPath: p.avatarPath || null,
    avatarRev: Number(p.avatarRev) || 0,
    isLocal: Boolean(p.isLocal),
    isHost: Boolean(p.isHost),
  }));
  const scores = state.scores || {};
  const ranked = sortAndRankByScore(
    buildEveningStandingPlayers({
      activePlayers,
      scores,
      gameScores: state.gameScores || {},
      resolveDisplayName: (key) => resolveLobbyDisplayName(key, participants),
    }),
    (p) => scores[p.name] || 0
  );
  const localName = getLocalDisplayName();
  const localUserId =
    participants.find((p) => p.isLocal)?.userId || getSupabaseUserId() || null;
  const me =
    ranked.find((p) => p.isLocal) ||
    ranked.find((p) => p.name === localName) ||
    null;
  const gameIds = resolveEveningGameScoreOrder({
    gameScoreOrder: state.gameScoreOrder,
    gameScores: state.gameScores,
    eveningGamesRecorded: state.eveningGamesRecorded,
  });
  const peerUserIds = participants
    .filter((p) => p.userId && !p.isLocal && String(p.userId) !== String(localUserId || ""))
    .map((p) => p.userId);

  return buildSignatureEveningPayload({
    profilePack: true,
    isGuest: false,
    loggedIn: true,
    lobbyId,
    hasActivity: true,
    localRank: me?.rank,
    localScore: me ? scores[me.name] || 0 : scores[localName] || 0,
    gameIds,
    peerUserIds,
  });
}

/** Persiste un snapshot atomique si le payload live est archivable. Ne supprime jamais un draft si le live est vide. */
export function refreshSignatureEveningArchiveDraft() {
  const payload = collectSignatureEveningArchivePayload();
  const userId = getSupabaseUserId();
  if (!payload || !userId) return false;
  return saveSignatureEveningArchiveDraft({ userId, lobbyId: payload.lobbyId, payload });
}

/**
 * LIVE > draft. `lobbyId` du snapshot membership Accueil — jamais un autre salon.
 * @returns {{ payload: object|null, source: "live"|"draft"|"none"|"stale"|"mismatch" }}
 */
export function resolveSignatureEveningArchivePayloadForLobby(lobbyId) {
  const lid = lobbyId != null ? String(lobbyId).trim() : "";
  if (!lid) return { payload: null, source: "none" };

  const live = collectSignatureEveningArchivePayload();
  if (live && String(live.lobbyId) === lid) {
    return { payload: live, source: "live" };
  }
  if (live && String(live.lobbyId) !== lid) {
    /* live d’un autre salon : ne pas fusionner */
  }

  const userId = getSupabaseUserId();
  const inspected = inspectSignatureEveningArchiveDraft(userId, lid);
  if (inspected.reason !== "ok" || !inspected.draft) {
    return { payload: null, source: inspected.reason === "stale" ? "stale" : inspected.reason };
  }
  const fromDraft = payloadFromSignatureCarnetDraft(inspected.draft);
  if (!fromDraft || String(fromDraft.lobbyId) !== lid) {
    return { payload: null, source: "mismatch" };
  }
  return { payload: fromDraft, source: "draft" };
}

function clearDraftAfterConfirmedArchive(payload) {
  const userId = getSupabaseUserId();
  const lobbyId = payload?.lobbyId;
  if (!userId || !lobbyId) return;
  clearSignatureEveningArchiveDraft(userId, lobbyId);
}

/** Best-effort : n’échoue jamais le leave. Passer un snapshot si l’état lobby peut disparaître. */
export async function archiveSignatureEveningQuiet(precollected = undefined) {
  const payload =
    precollected !== undefined ? precollected : collectSignatureEveningArchivePayload();
  if (!payload || !canCallCarnetRpc()) return { ok: true, skipped: true };
  try {
    const { error } = await supabase.rpc("archive_signature_evening", {
      p_lobby_id: payload.lobbyId,
      p_rank: payload.rank,
      p_score: payload.score,
      p_games: payload.games,
      p_peer_user_ids: payload.peerUserIds,
    });
    if (error) {
      const code = rpcCode(error);
      if (!SILENT_ARCHIVE_CODES.has(code)) {
        console.warn("REVEAL signature carnet archive:", error.message || error);
      }
      return { ok: false, code, skipped: false };
    }
    clearDraftAfterConfirmedArchive(payload);
    return { ok: true, skipped: false };
  } catch (e) {
    console.warn("REVEAL signature carnet archive:", e?.message || e);
    return { ok: false, skipped: false };
  }
}

export async function fetchSignatureCarnet() {
  if (!canCallCarnetRpc() || !isProfilePack()) {
    return { ok: false, skipped: true, evenings: [], stats: null };
  }
  const { data, error } = await supabase.rpc("list_signature_carnet", {});
  if (error) {
    const code = rpcCode(error);
    console.warn("REVEAL signature carnet list:", code || error.message || error);
    return { ok: false, skipped: false, code, evenings: [], stats: null };
  }
  let raw = data;
  if (typeof data === "string") {
    try {
      raw = JSON.parse(data);
    } catch {
      return { ok: false, skipped: false, evenings: [], stats: null };
    }
  }
  const parsed = parseCarnetListPayload(
    Array.isArray(raw) ? { evenings: raw } : raw
  );
  return { ok: true, skipped: false, ...parsed };
}

/**
 * C-HOME : archive live si encore là, sinon draft du même lobbyId.
 * Ne invente rien. Diagnostic explicite si skip.
 *
 * Échec RPC réel → bloquer le DELETE. Codes silencieux (pack / déjà hors membership)
 * ne piègent pas l’utilisateur : leave continue, sans prétendre que l’archive a réussi.
 */
export function shouldBlockServerLeaveUntilArchive(archiveRes) {
  if (!archiveRes || archiveRes.ok !== false) return false;
  if (archiveRes.skipped) return false;
  const code = archiveRes.code;
  if (code && SILENT_ARCHIVE_CODES.has(code)) return false;
  return true;
}

export async function archiveSignatureEveningForServerLeave(lobbyId) {
  const resolved = resolveSignatureEveningArchivePayloadForLobby(lobbyId);
  if (!resolved.payload) {
    console.warn("REVEAL C-HOME signature archive skipped:", {
      reason: resolved.source,
      lobbyId: lobbyId || null,
    });
    return { ok: true, skipped: true, source: resolved.source };
  }
  const res = await archiveSignatureEveningQuiet(resolved.payload);
  if (!res.ok) {
    console.warn("REVEAL C-HOME signature archive failed:", {
      code: res.code || null,
      lobbyId: lobbyId || null,
      source: resolved.source,
    });
  }
  return { ...res, source: resolved.source };
}

setSignatureEveningArchiveDraftListener(refreshSignatureEveningArchiveDraft);

