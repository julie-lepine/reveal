/**
 * Modèle local Draw it ! T6 — strokes + currentStroke.
 * Aucun réseau. Aucune écriture de session distante.
 */
import {
  DRAW_IT_PHASE_DRAWING,
  isDrawItRoundExpired,
} from "./drawItRound.js";

// Live T7 : buffer local long. Durable T8 : 80 points / stroke après downsample.
export const DRAW_IT_STROKE_MAX_POINTS = 4096;
export const DRAW_IT_DURABLE_STROKE_MAX_POINTS = 80;
export const DRAW_IT_STROKE_MAX_COUNT = 25;
export const DRAW_IT_STROKE_MIN_DIST = 0.012;
export const DRAW_IT_DEFAULT_COLOR = "#f4f4f5";
export const DRAW_IT_DEFAULT_WIDTH = 4;
export const DRAW_IT_TOOL_DRAW = "draw";
export const DRAW_IT_TOOL_ERASE = "erase";
export const DRAW_IT_ERASE_PREVIEW_COLOR = "rgba(156,163,175,0.55)";
export const DRAW_IT_TOOL_COLORS = [
  { id: "ink", value: "#f4f4f5", label: "Clair" },
  { id: "red", value: "#ef4444", label: "Rouge" },
  { id: "orange", value: "#f97316", label: "Orange" },
  { id: "yellow", value: "#facc15", label: "Jaune" },
  { id: "green", value: "#4ade80", label: "Vert" },
  { id: "blue", value: "#38bdf8", label: "Bleu" },
  { id: "violet", value: "#818cf8", label: "Violet" },
  { id: "pink", value: "#ec4899", label: "Rose" },
  { id: "gray", value: "#9ca3af", label: "Gris" },
];
export const DRAW_IT_TOOL_WIDTHS = [
  { id: "thin", value: 4, label: "Fin" },
  { id: "medium", value: 7, label: "Moyen" },
  { id: "thick", value: 12, label: "Épais" },
];
const DRAW_IT_ERASER_RADIUS_BY_WIDTH = {
  4: 0.024,
  7: 0.038,
  12: 0.055,
};

const DRAW_IT_HEX6 = /^#([0-9a-f]{6})$/i;
const DRAW_IT_HEX3 = /^#([0-9a-f]{3})$/i;

export function resolveDrawItToolColor(color) {
  const value = String(color || "").trim();
  const short = DRAW_IT_HEX3.exec(value);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = DRAW_IT_HEX6.exec(value);
  if (full) return `#${full[1]}`.toLowerCase();
  return DRAW_IT_DEFAULT_COLOR;
}

export function applyDrawItBrushColor(brush = {}, color) {
  return createDrawItBrush({
    color,
    width: brush.width,
    tool: brush.tool,
  });
}

export function resolveDrawItToolWidth(width) {
  const n = Number(width);
  return DRAW_IT_TOOL_WIDTHS.some((entry) => entry.value === n)
    ? n
    : DRAW_IT_DEFAULT_WIDTH;
}

export function createDrawItBrush(overrides = {}) {
  const tool =
    overrides.tool === DRAW_IT_TOOL_ERASE ? DRAW_IT_TOOL_ERASE : DRAW_IT_TOOL_DRAW;
  return {
    color: resolveDrawItToolColor(overrides.color),
    width: resolveDrawItToolWidth(overrides.width),
    tool,
  };
}

export function isDrawItEraseTool(tool) {
  return tool === DRAW_IT_TOOL_ERASE;
}

export function drawItEraserRadius(width) {
  const resolved = resolveDrawItToolWidth(width);
  return DRAW_IT_ERASER_RADIUS_BY_WIDTH[resolved] || DRAW_IT_ERASER_RADIUS_BY_WIDTH[4];
}

export function sanitizeEraseStrokeIds(ids, max = DRAW_IT_STROKE_MAX_COUNT) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw || "").trim();
    if (!id || id.length > 128 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

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

function pointToSegmentDistance(point, start, end) {
  if (!point || !start) return Infinity;
  if (!end) return pointDistance(point, start);
  const dx = Number(end[0]) - Number(start[0]);
  const dy = Number(end[1]) - Number(start[1]);
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return pointDistance(point, start);
  let t =
    ((Number(point[0]) - Number(start[0])) * dx +
      (Number(point[1]) - Number(start[1])) * dy) /
    len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(
    Number(point[0]) - (Number(start[0]) + t * dx),
    Number(point[1]) - (Number(start[1]) + t * dy)
  );
}

function polylineSegments(points) {
  const list = Array.isArray(points) ? points.filter(Boolean) : [];
  if (!list.length) return [];
  if (list.length === 1) return [[list[0], list[0]]];
  const out = [];
  for (let i = 1; i < list.length; i += 1) {
    out.push([list[i - 1], list[i]]);
  }
  return out;
}

export function strokeIntersectsErasePath(stroke, erasePoints, radius) {
  const hit = Number(radius);
  if (!Number.isFinite(hit) || hit <= 0) return false;
  const strokePts = Array.isArray(stroke?.points) ? stroke.points : [];
  const erasePts = Array.isArray(erasePoints) ? erasePoints : [];
  if (!strokePts.length || !erasePts.length) return false;
  const strokeWidthNorm = (Number(stroke.width) || DRAW_IT_DEFAULT_WIDTH) / 800;
  const threshold = hit + strokeWidthNorm;
  const strokeSegs = polylineSegments(strokePts);
  const eraseSegs = polylineSegments(erasePts);
  for (const [a, b] of eraseSegs) {
    for (const [c, d] of strokeSegs) {
      if (pointToSegmentDistance(a, c, d) <= threshold) return true;
      if (pointToSegmentDistance(b, c, d) <= threshold) return true;
      if (pointToSegmentDistance(c, a, b) <= threshold) return true;
      if (pointToSegmentDistance(d, a, b) <= threshold) return true;
    }
  }
  return false;
}

export function collectErasedStrokeIds(strokes, erasePoints, radius) {
  const ids = [];
  for (const stroke of Array.isArray(strokes) ? strokes : []) {
    const id = String(stroke?.strokeId || "").trim();
    if (!id) continue;
    if (strokeIntersectsErasePath(stroke, erasePoints, radius)) ids.push(id);
  }
  return sanitizeEraseStrokeIds(ids);
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
    suppressedStrokeIds: [],
  };
}

export function downsampleDrawItStrokePoints(
  points,
  max = DRAW_IT_DURABLE_STROKE_MAX_POINTS
) {
  const list = (Array.isArray(points) ? points : []).filter(Boolean);
  if (list.length <= max) return list;
  if (max <= 1) return list.slice(0, 1);
  const lastIndex = list.length - 1;
  const out = [];
  for (let i = 0; i < max; i += 1) {
    const index = Math.round((i * lastIndex) / (max - 1));
    const point = list[index];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) out.push(point);
  }
  if (out[out.length - 1] !== list[lastIndex]) {
    out[out.length - 1] = list[lastIndex];
  }
  return out.slice(0, max);
}

function sanitizeCompletedStroke(stroke, { maxPoints = DRAW_IT_DURABLE_STROKE_MAX_POINTS } = {}) {
  if (!stroke || typeof stroke !== "object") return null;
  const strokeId = String(stroke.strokeId || "").trim();
  if (!strokeId || strokeId.length > 128) return null;
  if (
    ["lobbyId", "game", "wordLabel", "wordId", "acceptedAnswers", "currentStroke"].some(
      (key) => Object.hasOwn(stroke, key)
    )
  ) {
    return null;
  }
  const seq = Number(stroke.seq);
  const canvasEpoch = Number(stroke.canvasEpoch);
  const points = downsampleDrawItStrokePoints(
    (Array.isArray(stroke.points) ? stroke.points : [])
      .map((point) => {
        if (!Array.isArray(point) || point.length !== 2) return null;
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (x < 0 || x > 1 || y < 0 || y > 1) return null;
        return [round3(x), round3(y)];
      })
      .filter(Boolean),
    maxPoints
  );
  if (!points.length) return null;
  const width = Number(stroke.width);
  return {
    strokeId,
    seq: Number.isInteger(seq) && seq >= 1 ? seq : 1,
    canvasEpoch: Number.isInteger(canvasEpoch) && canvasEpoch >= 0 ? canvasEpoch : 0,
    points,
    color:
      typeof stroke.color === "string" && stroke.color
        ? stroke.color.slice(0, 32)
        : DRAW_IT_DEFAULT_COLOR,
    width: Number.isFinite(width)
      ? Math.min(64, Math.max(1, width))
      : DRAW_IT_DEFAULT_WIDTH,
  };
}

export function toDurableDrawItStroke(stroke, session = {}) {
  return sanitizeCompletedStroke({
    ...stroke,
    seq: Number(stroke?.seq) || Math.max(1, Number(session.strokeSeq) || 1),
    canvasEpoch: Number(session.canvasEpoch) || 0,
    points: downsampleDrawItStrokePoints(stroke?.points),
  });
}

export function canPersistDrawItStroke(session, uid) {
  if (!session?.lobbyStarted) return { ok: false, reason: "not_started" };
  if (session.phase !== DRAW_IT_PHASE_DRAWING) {
    return { ok: false, reason: "not_drawing" };
  }
  if (!uid || !session.drawerUid || String(uid) !== String(session.drawerUid)) {
    return { ok: false, reason: "not_drawer" };
  }
  return { ok: true };
}

export function applyDrawItDurableAppend(session = {}, stroke, { uid } = {}) {
  const gate = canPersistDrawItStroke(session, uid);
  if (!gate.ok) return { ok: false, reason: gate.reason, session };
  const rawPoints = Array.isArray(stroke?.points) ? stroke.points : [];
  if (rawPoints.length > DRAW_IT_DURABLE_STROKE_MAX_POINTS && stroke?.downsample === false) {
    return { ok: false, reason: "too_long", session };
  }
  const durable = toDurableDrawItStroke(stroke, session);
  if (!durable) return { ok: false, reason: "invalid_stroke", session };
  if (Number(durable.canvasEpoch) !== (Number(session.canvasEpoch) || 0)) {
    return { ok: false, reason: "stale_epoch", session };
  }
  const existing = completedDrawItStrokesFromSession(session);
  if (existing.some((entry) => entry.strokeId === durable.strokeId)) {
    return { ok: true, skipped: true, session };
  }
  if (existing.length >= DRAW_IT_STROKE_MAX_COUNT) {
    return { ok: false, reason: "stroke_cap", session };
  }
  return {
    ok: true,
    skipped: false,
    session: {
      ...session,
      strokes: [...existing, durable],
      strokeSeq: Math.max(Number(session.strokeSeq) || 0, durable.seq),
    },
  };
}

export function applyDrawItDurableUndo(session = {}, strokeId, { uid } = {}) {
  const gate = canPersistDrawItStroke(session, uid);
  if (!gate.ok) return { ok: false, reason: gate.reason, session };
  const id = String(strokeId || "").trim();
  if (!id) return { ok: false, reason: "invalid_stroke", session };
  const existing = completedDrawItStrokesFromSession(session);
  const strokes = existing.filter((stroke) => stroke.strokeId !== id);
  if (strokes.length === existing.length) {
    return { ok: true, skipped: true, session };
  }
  return {
    ok: true,
    skipped: false,
    session: { ...session, strokes },
  };
}

export function applyDrawItDurableErase(session = {}, strokeIds, { uid } = {}) {
  const gate = canPersistDrawItStroke(session, uid);
  if (!gate.ok) return { ok: false, reason: gate.reason, session };
  const ids = new Set(sanitizeEraseStrokeIds(strokeIds));
  if (!ids.size) return { ok: true, skipped: true, session };
  const existing = completedDrawItStrokesFromSession(session);
  const strokes = existing.filter((stroke) => !ids.has(stroke.strokeId));
  if (strokes.length === existing.length) {
    return { ok: true, skipped: true, session };
  }
  return {
    ok: true,
    skipped: false,
    session: {
      ...session,
      strokes,
      suppressedStrokeIds: [
        ...new Set([...(session.suppressedStrokeIds || []), ...ids]),
      ],
    },
  };
}

export function applyDrawItDurableClear(session = {}, { uid, canvasEpoch } = {}) {
  const gate = canPersistDrawItStroke(session, uid);
  if (!gate.ok) return { ok: false, reason: gate.reason, session };
  const epoch = Number(session.canvasEpoch) || 0;
  if (canvasEpoch != null && Number(canvasEpoch) !== epoch) {
    return { ok: false, reason: "stale_epoch", session };
  }
  return {
    ok: true,
    skipped: false,
    session: {
      ...session,
      canvasEpoch: epoch + 1,
      strokes: [],
      strokeSeq: 0,
    },
  };
}

export function completedDrawItStrokesFromSession(session = {}) {
  if (!Array.isArray(session.strokes)) return [];
  const seen = new Set();
  return session.strokes
    .map(sanitizeCompletedStroke)
    .filter((stroke) => {
      if (!stroke || seen.has(stroke.strokeId)) return false;
      seen.add(stroke.strokeId);
      return true;
    })
    .slice(0, DRAW_IT_STROKE_MAX_COUNT);
}

function suppressedStrokeIdSet(session = {}) {
  return new Set(
    (Array.isArray(session.suppressedStrokeIds) ? session.suppressedStrokeIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
}

function strokesForCanvasEpoch(session = {}, epoch = Number(session.canvasEpoch) || 0) {
  const suppressed = suppressedStrokeIdSet(session);
  return completedDrawItStrokesFromSession(session).filter(
    (stroke) => Number(stroke.canvasEpoch) === epoch && !suppressed.has(stroke.strokeId)
  );
}

export function createDrawItBoardFromSession(session = {}) {
  const board = createEmptyDrawItBoard(session);
  const suppressed = [...suppressedStrokeIdSet(session)];
  return {
    ...board,
    strokeSeq: Math.max(0, Number(session.strokeSeq) || 0),
    strokes: strokesForCanvasEpoch(session, board.canvasEpoch),
    currentStroke: null,
    suppressedStrokeIds: suppressed,
  };
}

/**
 * Strokes terminés du snapshot durable, filtrés sur l'epoch courant.
 * Source du recap : jamais currentStroke / Broadcast / board local.
 */
export function recapDrawItStrokesFromSession(session = {}) {
  return strokesForCanvasEpoch(session)
    .slice()
    .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
}

export function createDrawItRecapBoardFromSession(session = {}) {
  return {
    ...createEmptyDrawItBoard(session),
    strokeSeq: Math.max(0, Number(session.strokeSeq) || 0),
    strokes: recapDrawItStrokesFromSession(session),
    currentStroke: null,
  };
}

/**
 * Fusion epoch-aware des snapshots durables.
 * Un epoch plus petit, ou un tableau de strokes plus ancien, ne doit pas
 * faire régresser un board/session déjà confirmé.
 */
export function mergeDrawItDurableSnapshot(local = {}, remote = {}) {
  const localEpoch = Number(local.canvasEpoch) || 0;
  const remoteEpoch = Number(remote.canvasEpoch) || 0;
  const suppressed = new Set([
    ...suppressedStrokeIdSet(local),
    ...suppressedStrokeIdSet(remote),
  ]);

  if (remoteEpoch > localEpoch) {
    const strokes = strokesForCanvasEpoch(
      { ...remote, suppressedStrokeIds: [] },
      remoteEpoch
    );
    return {
      canvasEpoch: remoteEpoch,
      strokes,
      strokeSeq: Math.max(Number(remote.strokeSeq) || 0, strokes.length),
      suppressedStrokeIds: [],
    };
  }

  if (remoteEpoch < localEpoch) {
    const strokes = strokesForCanvasEpoch(
      { ...local, suppressedStrokeIds: [...suppressed] },
      localEpoch
    );
    return {
      canvasEpoch: localEpoch,
      strokes,
      strokeSeq: Math.max(
        Number(local.strokeSeq) || 0,
        Number(remote.strokeSeq) || 0,
        strokes.length
      ),
      suppressedStrokeIds: [...suppressed],
    };
  }

  const byId = new Map();
  for (const stroke of [
    ...completedDrawItStrokesFromSession(local),
    ...completedDrawItStrokesFromSession(remote),
  ]) {
    if (Number(stroke.canvasEpoch) !== localEpoch) continue;
    if (suppressed.has(stroke.strokeId)) continue;
    if (!byId.has(stroke.strokeId)) byId.set(stroke.strokeId, stroke);
  }
  const strokes = [...byId.values()].slice(-DRAW_IT_STROKE_MAX_COUNT);
  const stillSuppressed = [...suppressed].filter((id) =>
    [...completedDrawItStrokesFromSession(local), ...completedDrawItStrokesFromSession(remote)]
      .some((stroke) => stroke.strokeId === id)
  );
  return {
    canvasEpoch: localEpoch,
    strokes,
    strokeSeq: Math.max(
      Number(local.strokeSeq) || 0,
      Number(remote.strokeSeq) || 0,
      strokes.length
    ),
    suppressedStrokeIds: stillSuppressed,
  };
}

export function absorbDrawItLiveCompletedStroke(board, stroke, session = {}) {
  if (!board) return createEmptyDrawItBoard(session);
  const epoch = Number(board.canvasEpoch) || 0;
  const sessionEpoch = Number(session.canvasEpoch);
  if (Number.isInteger(sessionEpoch) && sessionEpoch < epoch) return board;
  const suppressed = new Set(board.suppressedStrokeIds || []);
  const strokeId = String(stroke?.strokeId || "").trim();
  if (!strokeId || suppressed.has(strokeId)) return board;
  if ((board.strokes || []).some((entry) => entry.strokeId === strokeId)) return board;
  const durable = toDurableDrawItStroke(
    {
      ...stroke,
      seq: Number(stroke?.seq) || Number(stroke?.lastSeq) || (Number(board.strokeSeq) || 0) + 1,
      canvasEpoch: epoch,
    },
    { ...session, canvasEpoch: epoch, strokeSeq: board.strokeSeq }
  );
  if (!durable || Number(durable.canvasEpoch) !== epoch) return board;
  return {
    ...board,
    strokeSeq: Math.max(Number(board.strokeSeq) || 0, durable.seq),
    strokes: [...(board.strokes || []), durable].slice(-DRAW_IT_STROKE_MAX_COUNT),
  };
}

export function mergeCompletedDrawItStrokes(session = {}, incoming = []) {
  const extra = completedDrawItStrokesFromSession({ strokes: incoming });
  const durable = completedDrawItStrokesFromSession(session);
  if (!extra.length) return session;
  const byId = new Map(durable.map((stroke) => [stroke.strokeId, stroke]));
  let added = 0;
  for (const stroke of extra) {
    if (byId.has(stroke.strokeId)) continue;
    byId.set(stroke.strokeId, stroke);
    added += 1;
  }
  if (!added && durable.length === (Array.isArray(session.strokes) ? session.strokes.length : 0)) {
    return session;
  }
  const strokes = [...byId.values()].slice(-DRAW_IT_STROKE_MAX_COUNT);
  return {
    ...session,
    strokes,
    strokeSeq: Math.max(Number(session.strokeSeq) || 0, strokes.length),
  };
}

export function applyDrawItBoardUndo(board, strokeId) {
  if (!board) return createEmptyDrawItBoard();
  const id = String(strokeId || "").trim();
  if (!id) return board;
  const suppressed = [...new Set([...(board.suppressedStrokeIds || []), id])];
  return {
    ...board,
    strokes: (board.strokes || []).filter((stroke) => stroke.strokeId !== id),
    currentStroke:
      board.currentStroke?.strokeId === id ? null : board.currentStroke,
    suppressedStrokeIds: suppressed,
  };
}

export function applyDrawItBoardErase(board, strokeIds) {
  const ids = sanitizeEraseStrokeIds(strokeIds);
  if (!board || !ids.length) {
    return board ? { ...board, currentStroke: null } : createEmptyDrawItBoard();
  }
  let next = board;
  for (const id of ids) {
    next = applyDrawItBoardUndo(next, id);
  }
  return { ...next, currentStroke: null };
}

export function undoLastCompletedDrawItStroke(board) {
  if (!board || board.currentStroke) return board;
  const strokes = board.strokes || [];
  if (!strokes.length) return board;
  return applyDrawItBoardUndo(board, strokes[strokes.length - 1].strokeId);
}

export function applyDrawItBoardClear(board, canvasEpoch) {
  const nextEpoch =
    Number.isInteger(Number(canvasEpoch)) && Number(canvasEpoch) >= 0
      ? Number(canvasEpoch)
      : (Number(board?.canvasEpoch) || 0) + 1;
  return createEmptyDrawItBoard({
    runId: board?.runId,
    roundIdx: board?.roundIdx,
    canvasEpoch: nextEpoch,
  });
}

export function maybeResetDrawItBoard(board, session = {}) {
  const nextEpoch = Number(session.canvasEpoch) || 0;
  const nextIdx = Number(session.roundIdx) || 0;
  const nextRun = session.runId || null;
  const localEpoch = Number(board?.canvasEpoch) || 0;
  if (!board || board.runId !== nextRun || Number(board.roundIdx) !== nextIdx) {
    return createDrawItBoardFromSession(session);
  }
  if (localEpoch > nextEpoch) return board;
  if (localEpoch !== nextEpoch) {
    return createDrawItBoardFromSession(session);
  }
  const suppressed = new Set(board.suppressedStrokeIds || []);
  const durable = completedDrawItStrokesFromSession(session).filter(
    (stroke) =>
      Number(stroke.canvasEpoch) === nextEpoch && !suppressed.has(stroke.strokeId)
  );
  const stillSuppressed = [...suppressed].filter((id) =>
    (Array.isArray(session.strokes) ? session.strokes : []).some(
      (stroke) => String(stroke?.strokeId || "") === id
    )
  );
  if (!durable.length) {
    if (stillSuppressed.length === (board.suppressedStrokeIds || []).length) {
      return board;
    }
    return { ...board, suppressedStrokeIds: stillSuppressed };
  }
  const byId = new Map(
    [...durable, ...(board.strokes || [])]
      .filter((stroke) => {
        if (suppressed.has(stroke.strokeId)) return false;
        const strokeEpoch = Number(stroke.canvasEpoch);
        const epoch = Number.isInteger(strokeEpoch) ? strokeEpoch : nextEpoch;
        return epoch === nextEpoch;
      })
      .map((stroke) => [stroke.strokeId, stroke])
  );
  const strokes = [...byId.values()].slice(-DRAW_IT_STROKE_MAX_COUNT);
  const unchanged =
    strokes.length === (board.strokes?.length || 0) &&
    strokes.every((stroke, index) => stroke.strokeId === board.strokes[index]?.strokeId);
  if (
    unchanged &&
    Number(board.strokeSeq) >= (Number(session.strokeSeq) || 0) &&
    stillSuppressed.length === (board.suppressedStrokeIds || []).length
  ) {
    return board;
  }
  return {
    ...board,
    strokeSeq: Math.max(Number(board.strokeSeq) || 0, Number(session.strokeSeq) || 0),
    strokes,
    suppressedStrokeIds: stillSuppressed,
  };
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
  {
    color = DRAW_IT_DEFAULT_COLOR,
    width = DRAW_IT_DEFAULT_WIDTH,
    strokeId = null,
    tool = DRAW_IT_TOOL_DRAW,
  } = {}
) {
  if (!board) return createEmptyDrawItBoard();
  let next = board.currentStroke ? endDrawItStroke(board) : board;
  const erase = isDrawItEraseTool(tool);
  if (!erase && next.strokes.length >= DRAW_IT_STROKE_MAX_COUNT) {
    return { ...next, currentStroke: null };
  }
  if (!point) return next;
  const strokeSeq = Number(next.strokeSeq) + (erase ? 0 : 1);
  return {
    ...next,
    strokeSeq,
    currentStroke: {
      strokeId: strokeId || makeDrawItStrokeId(strokeSeq || next.strokeSeq || 1),
      seq: strokeSeq || Number(next.strokeSeq) || 1,
      canvasEpoch: Number(next.canvasEpoch) || 0,
      points: [point],
      tool: erase ? DRAW_IT_TOOL_ERASE : DRAW_IT_TOOL_DRAW,
      color: erase
        ? DRAW_IT_ERASE_PREVIEW_COLOR
        : resolveDrawItToolColor(color),
      width: Number.isFinite(Number(width))
        ? Math.min(64, Math.max(1, Number(width)))
        : DRAW_IT_DEFAULT_WIDTH,
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
  if (isDrawItEraseTool(stroke.tool)) {
    const points = downsampleDrawItStrokePoints(stroke.points);
    const ids = collectErasedStrokeIds(
      board.strokes,
      points,
      drawItEraserRadius(stroke.width)
    );
    return applyDrawItBoardErase({ ...board, currentStroke: null }, ids);
  }
  if (!stroke.points.length || board.strokes.length >= DRAW_IT_STROKE_MAX_COUNT) {
    return { ...board, currentStroke: null };
  }
  return {
    ...board,
    strokes: [
      ...board.strokes,
      {
        ...stroke,
        tool: DRAW_IT_TOOL_DRAW,
        seq: Number(stroke.seq) || Number(board.strokeSeq) || 0,
        canvasEpoch: Number(stroke.canvasEpoch) || Number(board.canvasEpoch) || 0,
      },
    ],
    currentStroke: null,
  };
}

export function applyDrawItPointer(board, type, point, allowed, opts = {}) {
  if (type === "down") {
    if (!allowed) return board;
    return beginDrawItStroke(board, point, opts);
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
