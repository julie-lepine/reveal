/**
 * Domaine Draw it ! T4 — boucle de manche (pur, testable).
 * phase === "drawing" | "reveal" est la seule source de vérité.
 * foundOrder ne termine jamais la manche.
 */
import { DRAW_IT_ROUND_DURATION_MS } from "../../data/drawIt.js";

export const DRAW_IT_PHASE_DRAWING = "drawing";
export const DRAW_IT_PHASE_REVEAL = "reveal";

const PUBLIC_SECRET_KEYS = [
  "wordId",
  "wordLabel",
  "deck",
  "words",
  "acceptedAnswers",
];

export function emptyDrawItPlayBuffers() {
  return {
    foundOrder: [],
    guesses: [],
    strokes: [],
    canvasEpoch: 0,
    strokeSeq: 0,
  };
}

/**
 * UIDs figés dans l'ordre du roster de lancement (déterministe, pas de reshuffle).
 * @param {Array<{ userId?: string }|string>} participants
 * @returns {string[]}
 */
export function buildDrawItDrawerOrder(participants = []) {
  const seen = new Set();
  const out = [];
  for (const item of participants || []) {
    const uid =
      typeof item === "string"
        ? item.trim()
        : item?.userId != null
          ? String(item.userId).trim()
          : "";
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

export function drawerUidForRound(drawerOrder, roundIdx) {
  if (!Array.isArray(drawerOrder) || drawerOrder.length === 0) return null;
  const idx = Number(roundIdx);
  if (!Number.isInteger(idx) || idx < 0) return null;
  return drawerOrder[idx % drawerOrder.length];
}

export function isDrawerUidInOrder(drawerUid, drawerOrder) {
  if (!drawerUid || !Array.isArray(drawerOrder)) return false;
  return drawerOrder.includes(String(drawerUid));
}

export function buildDrawItRoundTiming(
  nowMs = Date.now(),
  durationMs = DRAW_IT_ROUND_DURATION_MS
) {
  const start = Number(nowMs);
  const dur = Number(durationMs) || DRAW_IT_ROUND_DURATION_MS;
  return {
    roundStartAt: new Date(start).toISOString(),
    roundEndsAt: new Date(start + dur).toISOString(),
  };
}

export function remainingMsUntil(roundEndsAt, nowMs = Date.now()) {
  const end = Date.parse(roundEndsAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - Number(nowMs));
}

export function isDrawItRoundExpired(roundEndsAt, nowMs = Date.now()) {
  const end = Date.parse(roundEndsAt);
  if (!Number.isFinite(end)) return false;
  return Number(nowMs) >= end;
}

export function formatDrawItCountdown(remainingMs) {
  const ms = Math.max(0, Number(remainingMs) || 0);
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function freezeDrawItDrawerOrder(existing, incoming) {
  if (Array.isArray(existing) && existing.length) return existing;
  return buildDrawItDrawerOrder(incoming);
}

export function buildDrawItLaunchState({
  session = {},
  participants = [],
  nowMs = Date.now(),
  runId,
  durationMs = DRAW_IT_ROUND_DURATION_MS,
} = {}) {
  const drawerOrder = buildDrawItDrawerOrder(participants);
  const roundIdx = 0;
  const timing = buildDrawItRoundTiming(nowMs, durationMs);
  return {
    ...session,
    lobbyStarted: true,
    runId: runId || null,
    participants: Array.isArray(participants) ? participants.map((p) => ({ ...p })) : [],
    drawerOrder,
    roundIdx,
    phase: DRAW_IT_PHASE_DRAWING,
    drawerUid: drawerUidForRound(drawerOrder, roundIdx),
    ...timing,
    roundScored: false,
    lastRound: null,
    matchScores: session.matchScores && typeof session.matchScores === "object"
      ? session.matchScores
      : {},
    ...emptyDrawItPlayBuffers(),
  };
}

export function canCommitDrawItReveal(session, nowMs = Date.now()) {
  if (!session?.lobbyStarted) return { ok: false, reason: "not_started" };
  if (session.phase === DRAW_IT_PHASE_REVEAL) {
    return { ok: false, reason: "already_reveal" };
  }
  if (session.phase !== DRAW_IT_PHASE_DRAWING) {
    return { ok: false, reason: "not_drawing" };
  }
  if (!isDrawItRoundExpired(session.roundEndsAt, nowMs)) {
    return { ok: false, reason: "too_early" };
  }
  return { ok: true };
}

export function applyDrawItReveal(session, { wordLabel = "", nowMs = Date.now() } = {}) {
  const check = canCommitDrawItReveal(session, nowMs);
  if (!check.ok) return { ok: false, reason: check.reason, session };
  return {
    ok: true,
    session: {
      ...session,
      phase: DRAW_IT_PHASE_REVEAL,
      roundScored: true,
      lastRound: {
        roundIdx: session.roundIdx ?? 0,
        drawerUid: session.drawerUid || null,
        wordLabel: String(wordLabel || ""),
        foundOrder: Array.isArray(session.foundOrder) ? [...session.foundOrder] : [],
      },
    },
  };
}

export function canCommitDrawItNextRound(session) {
  if (!session?.lobbyStarted) return { ok: false, reason: "not_started" };
  if (session.phase !== DRAW_IT_PHASE_REVEAL) {
    return { ok: false, reason: "not_reveal" };
  }
  const nextIdx = Number(session.roundIdx) + 1;
  const total = Number(session.roundCount);
  if (!Number.isInteger(nextIdx) || nextIdx < 1) {
    return { ok: false, reason: "invalid_round" };
  }
  if (!Number.isFinite(total) || nextIdx >= total) {
    return { ok: false, reason: "last_round" };
  }
  if (!Array.isArray(session.drawerOrder) || !session.drawerOrder.length) {
    return { ok: false, reason: "missing_drawer_order" };
  }
  return { ok: true, nextIdx };
}

export function applyDrawItNextRound(
  session,
  { nowMs = Date.now(), durationMs = DRAW_IT_ROUND_DURATION_MS } = {}
) {
  const check = canCommitDrawItNextRound(session);
  if (!check.ok) return { ok: false, reason: check.reason, session };
  const drawerOrder = freezeDrawItDrawerOrder(session.drawerOrder, []);
  const drawerUid = drawerUidForRound(drawerOrder, check.nextIdx);
  if (!isDrawerUidInOrder(drawerUid, drawerOrder)) {
    return { ok: false, reason: "invalid_drawer", session };
  }
  const timing = buildDrawItRoundTiming(nowMs, durationMs);
  return {
    ok: true,
    session: {
      ...session,
      drawerOrder,
      runId: session.runId,
      participants: session.participants,
      roundIdx: check.nextIdx,
      phase: DRAW_IT_PHASE_DRAWING,
      drawerUid,
      ...timing,
      roundScored: false,
      ...emptyDrawItPlayBuffers(),
    },
  };
}

export function canCompleteDrawItGame(session) {
  if (!session?.lobbyStarted) return { ok: false, reason: "already_complete" };
  if (session.phase !== DRAW_IT_PHASE_REVEAL) {
    return { ok: false, reason: "not_reveal" };
  }
  const idx = Number(session.roundIdx);
  const total = Number(session.roundCount);
  if (!Number.isInteger(idx) || idx !== total - 1) {
    return { ok: false, reason: "not_last_round" };
  }
  return { ok: true };
}

/** Secrets interdits sur le blob public (hors lastRound.wordLabel après reveal). */
export function publicDrawItHasForbiddenSecrets(remote, { allowLastRoundWord = false } = {}) {
  if (!remote || typeof remote !== "object") return false;
  for (const key of PUBLIC_SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(remote, key)) return true;
  }
  if (remote.phase === DRAW_IT_PHASE_DRAWING && remote.lastRound?.wordLabel) {
    // lastRound.wordLabel d'une manche précédente est public (déjà révélée).
    // Le mot courant ne doit pas être au top-level (déjà vérifié).
  }
  if (!allowLastRoundWord && remote.phase === DRAW_IT_PHASE_DRAWING) {
    const currentLabel = remote.currentWordLabel || remote.word || null;
    if (currentLabel) return true;
  }
  return false;
}

export function stripDrawItPublicSecrets(session = {}) {
  const out = { ...session };
  for (const key of PUBLIC_SECRET_KEYS) {
    delete out[key];
  }
  return out;
}
