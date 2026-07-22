/**
 * Contrats purs I-08 / ARCH-03 (sans Supabase) — miroir des règles SQL.
 * Les tests SQL d'intégration se font manuellement dans le SQL Editor après migration.
 */

export const HOST_PRESENCE_STALE_SECONDS = 120;

/**
 * Élection acting host alignée sur is_acting_host SQL / hostPresence.js
 * @param {{ userId: string, lastSeenAt: string|null, isHost?: boolean }[]} members
 * @param {string} hostId
 * @param {number} nowMs
 */
export function resolveActingHostServerLike(members, hostId, nowMs = Date.now()) {
  const staleMs = HOST_PRESENCE_STALE_SECONDS * 1000;
  const isPresent = (m) => {
    if (!m?.lastSeenAt) return true;
    const t = new Date(m.lastSeenAt).getTime();
    if (!Number.isFinite(t)) return true;
    return nowMs - t < staleMs;
  };

  const host = members.find((m) => m.userId === hostId);
  if (host && isPresent(host)) return hostId;

  const present = members
    .filter((m) => m.userId && isPresent(m))
    .map((m) => m.userId)
    // Aligné SQL : ORDER BY user_id::text ASC LIMIT 1
    .sort((a, b) => String(a).localeCompare(String(b)));
  return present[0] || hostId;
}

export function isActingHostServerLike(uid, members, hostId, nowMs = Date.now()) {
  if (!uid) return false;
  return resolveActingHostServerLike(members, hostId, nowMs) === uid;
}

/** Whitelist kind/game pour contribute (miroir SQL). */
export function isContributePairAllowed(game, kind) {
  const g = String(game || "").toLowerCase();
  const k = String(kind || "").toLowerCase();
  const readyGames = new Set([
    "hottake",
    "dilemma",
    "speedvote",
    "clutch",
    "wronganswer",
    "traitre",
    "playlistguess",
    "trivia",
    "consensus",
    "truthmeter",
  ]);
  const voteGames = new Set([
    "hottake",
    "dilemma",
    "speedvote",
    "wronganswer",
    "traitre",
    "playlistguess",
    "truthmeter",
    "guesslie",
    "tiernightlive",
  ]);
  if (k === "ready") return readyGames.has(g);
  if (k === "vote") return voteGames.has(g);
  if (k === "answer") return ["wronganswer", "trivia", "consensus"].includes(g);
  if (k === "tap") return g === "clutch";
  if (k === "deal_ack") return g === "traitre";
  if (k === "submission") return g === "guesslie";
  if (k === "placement" || k === "finished") return g === "tiernight";
  return false;
}
