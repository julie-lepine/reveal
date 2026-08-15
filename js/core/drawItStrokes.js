/**
 * Modèle local Draw it ! T6 — strokes + currentStroke.
 * Aucun réseau. Aucune écriture de session distante.
 */
import {
  DRAW_IT_PHASE_DRAWING,
  isDrawItRoundExpired,
} from "./drawItRound.js";

export const DRAW_IT_STROKE_MAX_POINTS = 80;
export const DRAW_IT_STROKE_MAX_COUNT = 25;
export const DRAW_IT_STROKE_MIN_DIST = 0.012;
export const DRAW_IT_DEFAULT_COLOR = "#f4f4f5";
export const DRAW_IT_DEFAULT_WIDTH = 4;

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

export function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

export function clientPointToNormalized(clientX, clientY, rect) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const x = width > 0 ? (Number(clientX) - left) / width : 0;
  const y = height > 0 ? (Number(clientY) - top) / height : 0;
  return [round3(clamp01(x)), round3(clamp01(y))];
}

export function pointDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));
}

export function shouldKeepSimplifiedPoint(
  prev,
  next,
  minDist = DRAW_IT_STROKE_MIN_DIST
) {
  if (!prev) return true;
  return pointDistance(prev, next) >= minDist;
}

export function appendSimplifiedPoint(
  points,
  point,
  {
    maxPoints = DRAW_IT_STROKE_MAX_POINTS,
    minDist = DRAW_IT_STROKE_MIN_DIST,
    force = false,
  } = {}
) {
  const list = Array.isArray(points) ? points : [];
  if (!point) return list.slice(0, maxPoints);
  if (list.length >= maxPoints) return list.slice(0, maxPoints);
  const last = list[list.length - 1];
  if (last && last[0] === point[0] && last[1] === point[1]) return list;
  if (!force && last && !shouldKeepSimplifiedPoint(last, point, minDist)) {
    return list;
  }
  return [...list, point].slice(0, maxPoints);
}

export function makeDrawItStrokeId(strokeSeq) {
  return `s${Number(strokeSeq) || 0}`;
}

export function createEmptyDrawItBoard({
  runId = null,
  roundIdx = 0,
  canvasEpoch = 0,
} = {}) {
  return {
    runId: runId || null,
    roundIdx: Number(roundIdx) || 0,
    canvasEpoch: Number(canvasEpoch) || 0,
    strokeSeq: 0,
    strokes: [],
    currentStroke: null,
  };
}

export function maybeResetDrawItBoard(board, session = {}) {
  const nextEpoch = Number(session.canvasEpoch) || 0;
  const nextIdx = Number(session.roundIdx) || 0;
  const nextRun = session.runId || null;
  if (
    !board ||
    board.runId !== nextRun ||
    Number(board.roundIdx) !== nextIdx ||
    Number(board.canvasEpoch) !== nextEpoch
  ) {
    return createEmptyDrawItBoard({
      runId: nextRun,
      roundIdx: nextIdx,
      canvasEpoch: nextEpoch,
    });
  }
  return board;
}

/**
 * foundOrder ne désactive jamais le canvas.
 * Le timer local expire le dessin sans changer phase.
 */
export function canDrawOnDrawItCanvas(
  session,
  { uid, nowMs = Date.now() } = {}
) {
  if (!session?.lobbyStarted) return { ok: false, reason: "not_started" };
  if (session.phase !== DRAW_IT_PHASE_DRAWING) {
    return { ok: false, reason: "not_drawing" };
  }
  if (isDrawItRoundExpired(session.roundEndsAt, nowMs)) {
    return { ok: false, reason: "expired" };
  }
  if (!uid || !session.drawerUid || String(uid) !== String(session.drawerUid)) {
    return { ok: false, reason: "not_drawer" };
  }
  return { ok: true };
}

export function beginDrawItStroke(
  board,
  point,
  { color = DRAW_IT_DEFAULT_COLOR, width = DRAW_IT_DEFAULT_WIDTH } = {}
) {
  if (!board) return createEmptyDrawItBoard();
  let next = board.currentStroke ? endDrawItStroke(board) : board;
  if (next.strokes.length >= DRAW_IT_STROKE_MAX_COUNT) {
    return { ...next, currentStroke: null };
  }
  if (!point) return next;
  const strokeSeq = Number(next.strokeSeq) + 1;
  return {
    ...next,
    strokeSeq,
    currentStroke: {
      strokeId: makeDrawItStrokeId(strokeSeq),
      points: [point],
      color,
      width,
    },
  };
}

export function extendDrawItStroke(board, point, opts = {}) {
  if (!board?.currentStroke || !point) return board;
  const points = appendSimplifiedPoint(board.currentStroke.points, point, opts);
  return {
    ...board,
    currentStroke: { ...board.currentStroke, points },
  };
}

export function endDrawItStroke(board, finalPoint) {
  if (!board?.currentStroke) {
    return board ? { ...board, currentStroke: null } : createEmptyDrawItBoard();
  }
  let stroke = board.currentStroke;
  if (finalPoint) {
    stroke = {
      ...stroke,
      points: appendSimplifiedPoint(stroke.points, finalPoint, { force: true }),
    };
  }
  if (!stroke.points.length || board.strokes.length >= DRAW_IT_STROKE_MAX_COUNT) {
    return { ...board, currentStroke: null };
  }
  return {
    ...board,
    strokes: [...board.strokes, stroke],
    currentStroke: null,
  };
}

export function applyDrawItPointer(board, type, point, allowed) {
  if (type === "down") {
    if (!allowed) return board;
    return beginDrawItStroke(board, point);
  }
  if (type === "move") {
    if (!allowed) {
      return board?.currentStroke ? endDrawItStroke(board) : board;
    }
    return extendDrawItStroke(board, point);
  }
  if (type === "up" || type === "cancel") {
    return endDrawItStroke(board, point);
  }
  return board;
}

export function strokePointsToPixels(points, width, height) {
  return (Array.isArray(points) ? points : []).map(([x, y]) => [
    Number(x) * Number(width),
    Number(y) * Number(height),
  ]);
}
