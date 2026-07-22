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

/** Message client aligné sur le refus evening scores (hôte réel only). */
export const EVENING_SCORES_RESERVED_MSG = "Scores de soirée réservés à l'hôte.";

/**
 * Miroir de la whitelist `apply_acting_host_play` (merge_play).
 * Garder aligné avec supabase/game-sessions-i08-arch03.sql (+ hotfix takeScored).
 */
export const ACTING_HOST_PLAY_ALLOWED_KEYS = new Set([
  "phase",
  "roundIdx",
  "takeIdx",
  "questionIdx",
  "votes",
  "voteEndsAt",
  "roundScored",
  "takeScored",
  "pausedBy",
  "taps",
  "answers",
  "dealAcks",
  "currentDilemma",
  "currentTake",
  "affirmation",
  "authorEstimate",
  "finished",
  "placements",
  "matchScores",
  "lastRound",
  "roundResults",
  "speakEndsAt",
  "answerEndsAt",
  "displayEndsAt",
  "forceReveal",
  "allAnswered",
  "podium",
  "final",
  "deckCursor",
  "itemIdx",
  "tierVotes",
  "accumulated",
  "currentItem",
  "itemsLeft",
  "revealIndex",
  "scored",
  "intermissionEndsAt",
  "voteTimerRemaining",
]);

/** @returns {{ ok: true } | { ok: false, key: string }} */
export function validateActingHostPlayPatch(playPatch) {
  if (!playPatch || typeof playPatch !== "object") {
    return { ok: false, key: "(invalid)" };
  }
  for (const key of Object.keys(playPatch)) {
    if (!ACTING_HOST_PLAY_ALLOWED_KEYS.has(key)) {
      return { ok: false, key };
    }
  }
  return { ok: true };
}

/**
 * Chemin non-hôte réel (`patchGameStateAsNonHost`) :
 * - pas de flag evening → OK, play éventuel
 * - flag evening + acting host → OK mais drop evening (RPC refuse scores/soirée ;
 *   matchScores restent dans le playPatch whitelist)
 * - flag evening + invité ordinaire → erreur (popup observée en QA)
 *
 * Ne confère pas l'identité d'hôte : evening reste réservé à l'hôte réel
 * (`isLobbyHost` + UPDATE direct).
 */
export function resolveNonHostEveningScoresPolicy({
  withEveningScores = false,
  canActAsHost = false,
} = {}) {
  if (!withEveningScores) {
    return { ok: true, dropEveningScores: false };
  }
  if (canActAsHost) {
    return { ok: true, dropEveningScores: true };
  }
  return {
    ok: false,
    dropEveningScores: true,
    error: EVENING_SCORES_RESERVED_MSG,
  };
}
