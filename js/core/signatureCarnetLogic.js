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

/** 1er / 2e / reste — pour la répartition des rangs. */
export function aggregateCarnetRankSplit(evenings = []) {
  let first = 0;
  let second = 0;
  let rest = 0;
  for (const row of Array.isArray(evenings) ? evenings : []) {
    const r = Number(row?.rank);
    if (r === 1) first += 1;
    else if (r === 2) second += 1;
    else if (Number.isInteger(r) && r >= 3) rest += 1;
  }
  return { first, second, rest };
}

/** Largeur des barres (0–100), calée sur le max pour que le plus fréquent remplisse. */
export function carnetRankBarPercents(split = {}) {
  const first = Math.max(0, Number(split.first) || 0);
  const second = Math.max(0, Number(split.second) || 0);
  const rest = Math.max(0, Number(split.rest) || 0);
  const max = Math.max(first, second, rest, 1);
  const pct = (n) => (n > 0 ? Math.max(8, Math.round((n / max) * 100)) : 0);
  return { first: pct(first), second: pct(second), rest: pct(rest) };
}

/** Soirées du plus ancien au plus récent (courbe gauche → droite). */
export function chronologicalCarnetEvenings(evenings = []) {
  const rows = Array.isArray(evenings) ? evenings : [];
  return rows
    .map((row, i) => {
      const t = Date.parse(row?.endedAt);
      return { row, i, t: Number.isFinite(t) ? t : 0 };
    })
    .sort((a, b) => (a.t !== b.t ? a.t - b.t : a.i - b.i))
    .map((x) => x.row);
}

export function carnetWinrateRing(winrate, { radius = 38, stroke = 7 } = {}) {
  const r = Number(radius) || 38;
  const s = Number(stroke) || 7;
  const c = 2 * Math.PI * r;
  const pct =
    winrate == null || !Number.isFinite(winrate) ? 0 : Math.max(0, Math.min(1, winrate));
  return {
    radius: r,
    stroke: s,
    size: Math.round((r + s) * 2),
    circumference: Math.round(c * 100) / 100,
    dash: Math.round(pct * c * 100) / 100,
    percent: Math.round(pct * 100),
  };
}

/** Points SVG pour la courbe des scores (Y haut = meilleur score). */
export function carnetSparklineLayout(
  scores = [],
  { width = 200, height = 72, pad = 10 } = {}
) {
  const w = Number(width) || 200;
  const h = Number(height) || 72;
  const p = Number(pad) || 10;
  const list = Array.isArray(scores)
    ? scores.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [];
  if (!list.length) {
    return { width: w, height: h, points: "", area: "", dots: [], min: null, max: null };
  }
  const min = Math.min(...list);
  const max = Math.max(...list);
  const span = max - min || 1;
  const innerW = w - p * 2;
  const innerH = h - p * 2;
  const n = list.length;
  const round = (v) => Math.round(v * 10) / 10;
  const dots = list.map((score, i) => {
    const x = n === 1 ? w / 2 : p + (i / (n - 1)) * innerW;
    const y = p + (1 - (score - min) / span) * innerH;
    return { x: round(x), y: round(y), score };
  });
  const points = dots.map((d) => `${d.x},${d.y}`).join(" ");
  const baseY = h - p;
  const area = `M ${dots[0].x} ${baseY} L ${dots
    .map((d) => `${d.x} ${d.y}`)
    .join(" ")} L ${dots[dots.length - 1].x} ${baseY} Z`;
  return { width: w, height: h, points, area, dots, min, max };
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
  const src = Array.isArray(raw)
    ? { evenings: raw }
    : raw && typeof raw === "object"
      ? raw
      : {};
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
