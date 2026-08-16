/**
 * Contrats purs I-08 / ARCH-03 (sans Supabase) - miroir des règles SQL.
 * Les tests SQL d'intégration se font manuellement dans le SQL Editor après migration.
 */

export const HOST_PRESENCE_STALE_SECONDS = 120;

/** Miroir SQL claim_lobby_host_if_stale (seuil transfert réel). */
export const HOST_TRANSFER_STALE_SECONDS = 300;

/**
 * Élection acting host alignée sur is_acting_host SQL / hostPresence.js
 * @param {{ userId: string, lastSeenAt: string|null, isHost?: boolean }[]} members
 * @param {string} hostId
 * @param {number} nowMs
 * @param {number} [staleMs]
 */
export function resolveActingHostServerLike(
  members,
  hostId,
  nowMs = Date.now(),
  staleMs = HOST_PRESENCE_STALE_SECONDS * 1000
) {
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

export function isActingHostServerLike(
  uid,
  members,
  hostId,
  nowMs = Date.now(),
  staleMs = HOST_PRESENCE_STALE_SECONDS * 1000
) {
  if (!uid) return false;
  return resolveActingHostServerLike(members, hostId, nowMs, staleMs) === uid;
}

/** Éligibilité claim transfert (seuil 5 min) - miroir serveur, UX only. */
export function isClaimHostCandidateServerLike(uid, members, hostId, nowMs = Date.now()) {
  return isActingHostServerLike(
    uid,
    members,
    hostId,
    nowMs,
    HOST_TRANSFER_STALE_SECONDS * 1000
  );
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
    "trivia",
    "consensus",
    "truthmeter",
    "drawit",
  ]);
  const voteGames = new Set([
    "hottake",
    "dilemma",
    "speedvote",
    "wronganswer",
    "traitre",
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
 * Aligné sur la dernière définition SQL repo de cette RPC (clés merge_play).
 * Draw it ! n'y figure pas : strokes / drawer / epoch passent par des RPC
 * drawer-only (`append_drawit_stroke`, etc.).
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
  "questionScored",
  "podiumApplied",
]);

/**
 * Validations Trivia acting host (miroir SQL validate_trivia_acting_host_patch).
 * @param {object|null} serverTrivia état trivia serveur avant patch
 * @param {object} playPatch patch distant filtré
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateTriviaActingHostPlayPatch(serverTrivia = {}, playPatch = {}) {
  if (!playPatch || typeof playPatch !== "object") {
    return { ok: false, reason: "patch invalide" };
  }

  if (Object.prototype.hasOwnProperty.call(playPatch, "roundScored")) {
    return { ok: false, reason: "roundScored interdit pour Trivia" };
  }
  if (
    playPatch.questionScored != null &&
    Object.prototype.hasOwnProperty.call(playPatch, "roundScored")
  ) {
    return { ok: false, reason: "questionScored et roundScored simultanés" };
  }

  const curPhase = serverTrivia?.phase ?? null;
  const curIdx = Number(serverTrivia?.questionIdx ?? 0);
  const questionCount = Number(serverTrivia?.questionCount ?? 5);
  const lastQuestionIdx = Math.max(0, questionCount - 1);
  const newPhase = playPatch.phase ?? null;
  const newIdx =
    playPatch.questionIdx != null ? Number(playPatch.questionIdx) : curIdx;

  if (Object.prototype.hasOwnProperty.call(playPatch, "answers")) {
    const answers = playPatch.answers;
    if (answers == null || Array.isArray(answers) || typeof answers !== "object") {
      return { ok: false, reason: "answers doit être un objet" };
    }
    if (Object.keys(answers).length !== 0) {
      return { ok: false, reason: "answers doit être vide" };
    }
    if (curPhase !== "reveal") {
      return { ok: false, reason: "reset answers uniquement depuis reveal" };
    }
    if (newPhase !== "question") {
      return { ok: false, reason: "reset answers uniquement vers question" };
    }
    if (newIdx !== curIdx + 1) {
      return { ok: false, reason: "questionIdx incohérent pour reset answers" };
    }
  }

  if (playPatch.questionScored === true) {
    if (curPhase !== "question") {
      return { ok: false, reason: "questionScored:true uniquement depuis question" };
    }
    if (newPhase !== "reveal") {
      return { ok: false, reason: "questionScored:true uniquement vers reveal" };
    }
  }

  if (playPatch.questionScored === false) {
    if (curPhase !== "reveal") {
      return { ok: false, reason: "questionScored:false uniquement depuis reveal" };
    }
    if (newPhase !== "question") {
      return { ok: false, reason: "questionScored:false uniquement vers question" };
    }
    if (newIdx !== curIdx + 1) {
      return { ok: false, reason: "questionIdx incohérent pour nouvelle question" };
    }
  }

  if (playPatch.podiumApplied === true) {
    if (curPhase !== "reveal") {
      return { ok: false, reason: "podiumApplied uniquement depuis reveal" };
    }
    if (newPhase !== "final") {
      return { ok: false, reason: "podiumApplied uniquement vers final" };
    }
    if (curIdx !== lastQuestionIdx) {
      return { ok: false, reason: "podiumApplied uniquement sur dernière question" };
    }
  }

  return { ok: true };
}

/** Merge shallow trivia (miroir SQL ||) pour tests de préservation answers. */
export function mergeTriviaActingHostPlayShallow(serverTrivia = {}, playPatch = {}) {
  return { ...serverTrivia, ...playPatch };
}

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
