/**
 * FEATURE-PROFILE-04 — helpers purs (snapshot, stats, libellés).
 * Pas de fetch, pas de DOM, pas d’import lobby.
 */
import { SESSION_GAME_ID_TO_TILE } from "./gameCatalogTitle.js";

export const SIGNATURE_CARNET_ALLOWED_GAMES = Object.freeze(
  Object.keys(SESSION_GAME_ID_TO_TILE)
);

export const SIGNATURE_CARNET_MAX_EVENINGS = 20;

const ALLOWED = new Set(SIGNATURE_CARNET_ALLOWED_GAMES);

export function sanitizeCarnetGames(ids = []) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || !ALLOWED.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 24) break;
  }
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeCarnetPeerIds(ids = []) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const s = String(id || "").trim();
    if (!UUID_RE.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 16) break;
  }
  return out;
}

export function sanitizeCarnetRank(rank) {
  const n = Number(rank);
  if (!Number.isInteger(n) || n < 1 || n > 16) return null;
  return n;
}

export function sanitizeCarnetScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-9999, Math.min(99999, Math.round(n)));
}

/**
 * Snapshot à envoyer à archive_signature_evening, ou null si rien à archiver.
 * @param {{
 *   profilePack: boolean,
 *   isGuest: boolean,
 *   loggedIn: boolean,
 *   lobbyId: string|null|undefined,
 *   hasActivity: boolean,
 *   localRank: number|null|undefined,
 *   localScore: number|null|undefined,
 *   gameIds: string[],
 *   peerUserIds?: string[],
 * }} input
 */
export function buildSignatureEveningPayload(input) {
  if (!input?.profilePack || input.isGuest || !input.loggedIn) return null;
  const lobbyId = input.lobbyId != null ? String(input.lobbyId).trim() : "";
  if (!lobbyId || !input.hasActivity) return null;
  const rank = sanitizeCarnetRank(input.localRank);
  if (rank == null) return null;
  return {
    lobbyId,
    rank,
    score: sanitizeCarnetScore(input.localScore),
    games: sanitizeCarnetGames(input.gameIds),
    peerUserIds: sanitizeCarnetPeerIds(input.peerUserIds),
  };
}

export function aggregateCarnetStats(evenings = []) {
  const rows = Array.isArray(evenings) ? evenings : [];
  const counts = new Map();
  let games = 0;
  let wins = 0;
  for (const row of rows) {
    const ids = Array.isArray(row?.games) ? row.games : [];
    games += ids.length;
    if (Number(row?.rank) === 1) wins += 1;
    for (const id of ids) {
      if (typeof id !== "string" || !ALLOWED.has(id)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  let favoriteGame = null;
  let favoriteCount = 0;
  for (const [id, n] of counts) {
    if (n > favoriteCount || (n === favoriteCount && (!favoriteGame || id < favoriteGame))) {
      favoriteGame = id;
      favoriteCount = n;
    }
  }
  const n = rows.length;
  return {
    evenings: n,
    games,
    wins,
    mvp: wins,
    winrate: n ? wins / n : null,
    favoriteGame,
  };
}

export function formatCarnetWinrate(winrate) {
  if (winrate == null || !Number.isFinite(winrate)) return "—";
  return `${Math.round(winrate * 100)}%`;
}

export function formatCarnetEveningDate(iso, now = new Date()) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  void now;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function parseCarnetListPayload(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const eveningsIn = Array.isArray(src.evenings) ? src.evenings : [];
  const evenings = eveningsIn.slice(0, SIGNATURE_CARNET_MAX_EVENINGS).map((row) => ({
    endedAt: row?.ended_at || row?.endedAt || null,
    rank: sanitizeCarnetRank(row?.rank) || null,
    score: sanitizeCarnetScore(row?.score),
    games: sanitizeCarnetGames(row?.games),
    friendNames: Array.isArray(row?.friend_names)
      ? row.friend_names.map((n) => String(n || "").trim()).filter(Boolean)
      : Array.isArray(row?.friendNames)
        ? row.friendNames.map((n) => String(n || "").trim()).filter(Boolean)
        : [],
  }));
  const server = src.stats && typeof src.stats === "object" ? src.stats : null;
  const local = aggregateCarnetStats(evenings);
  const eveningsN = Number.isFinite(Number(server?.evenings))
    ? Number(server.evenings)
    : local.evenings;
  const winsN = Number.isFinite(Number(server?.wins)) ? Number(server.wins) : local.wins;
  const favoriteRaw =
    typeof server?.favorite_game === "string"
      ? server.favorite_game
      : typeof server?.favoriteGame === "string"
        ? server.favoriteGame
        : local.favoriteGame;
  return {
    evenings,
    stats: {
      evenings: eveningsN,
      games: Number.isFinite(Number(server?.games)) ? Number(server.games) : local.games,
      wins: winsN,
      mvp: Number.isFinite(Number(server?.mvp)) ? Number(server.mvp) : local.mvp,
      favoriteGame: sanitizeCarnetGames(favoriteRaw ? [favoriteRaw] : [])[0] || null,
      winrate: eveningsN ? winsN / eveningsN : null,
    },
  };
}
