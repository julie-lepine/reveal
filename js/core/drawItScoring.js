import {
  DRAW_IT_DRAWER_POINTS_PER_FIND,
  DRAW_IT_FINDER_POINTS,
  DRAW_IT_LATER_FINDER_POINTS,
} from "../../data/drawIt.js";
import { sortAndRankByScore } from "./competitionRank.js";

function applyScoreDeltas(scores = {}, deltas = {}) {
  const next = { ...scores };
  for (const [name, value] of Object.entries(deltas)) {
    const points = Number(value);
    if (Number.isFinite(points) && points > 0) {
      next[name] = (Number(next[name]) || 0) + points;
    }
  }
  return next;
}

function participantIndex(session = {}) {
  const byUid = new Map();
  for (const participant of Array.isArray(session.participants)
    ? session.participants
    : []) {
    const uid = String(participant?.userId || "").trim();
    if (!uid || byUid.has(uid)) continue;
    byUid.set(uid, String(participant?.name || uid));
  }
  if (!byUid.size) {
    for (const uidValue of Array.isArray(session.drawerOrder)
      ? session.drawerOrder
      : []) {
      const uid = String(uidValue || "").trim();
      if (uid && !byUid.has(uid)) byUid.set(uid, uid);
    }
  }
  return byUid;
}

export function drawItFinderPoints(rankIndex) {
  const index = Number(rankIndex);
  if (!Number.isInteger(index) || index < 0) return 0;
  return DRAW_IT_FINDER_POINTS[index] ?? DRAW_IT_LATER_FINDER_POINTS;
}

/** Delta name-keyed du round courant ; foundOrder reste UID-keyed. */
export function drawItRoundScoreDeltas(session = {}) {
  const players = participantIndex(session);
  const drawerUid = String(session.drawerUid || "");
  const deltas = {};
  for (const name of players.values()) deltas[name] = 0;

  const seen = new Set();
  let rankIndex = 0;
  for (const entry of Array.isArray(session.foundOrder)
    ? session.foundOrder
    : []) {
    const uid = String(entry?.uid ?? entry ?? "").trim();
    if (!uid || uid === drawerUid || !players.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
    deltas[players.get(uid)] = drawItFinderPoints(rankIndex);
    rankIndex += 1;
  }

  if (drawerUid && players.has(drawerUid)) {
    deltas[players.get(drawerUid)] =
      rankIndex * DRAW_IT_DRAWER_POINTS_PER_FIND;
  }
  return deltas;
}

export function awardDrawItRound(session = {}) {
  const scoreKey = `${String(session.runId || "")}:${Number(session.roundIdx) || 0}`;
  if (session.roundScored) {
    return {
      applied: false,
      scoreKey,
      deltas: session.lastRound?.deltas || {},
      matchScores: { ...(session.matchScores || {}) },
    };
  }
  const deltas = drawItRoundScoreDeltas(session);
  return {
    applied: true,
    scoreKey,
    deltas,
    matchScores: applyScoreDeltas(session.matchScores || {}, deltas),
  };
}

export function buildDrawItStandings(session = {}, roster = []) {
  const players = participantIndex(session);
  const scores = session.matchScores || {};
  const visualsByName = new Map();
  const visualsByUid = new Map();
  for (const player of Array.isArray(roster) ? roster : []) {
    if (player?.name) visualsByName.set(String(player.name), player);
    if (player?.userId) visualsByUid.set(String(player.userId), player);
  }
  return sortAndRankByScore(
    [...players.entries()].map(([uid, name]) => {
      const visual = visualsByUid.get(uid) || visualsByName.get(name);
      return {
        name,
        score: Number(scores[name]) || 0,
        emoji: visual?.emoji || "🙂",
        color: visual?.color || "#888",
      };
    }),
    (player) => player.score
  );
}
