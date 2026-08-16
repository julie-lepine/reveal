/**
 * Canvas Draw it ! — T6 local + rendu live incrémental T7.
 * Aucun RPC, contribute, ni écriture de session distante.
 */
import {
  applyDrawItPointer,
  canDrawOnDrawItCanvas,
  clientPointToNormalized,
  maybeResetDrawItBoard,
} from "./drawItStrokes.js";

function drawStroke(ctx, stroke, canvasWidth, canvasHeight, dpr) {
  const points = stroke?.points;
  if (!points?.length) return;
  ctx.save();
  ctx.strokeStyle = stroke.color || "#f4f4f5";
  ctx.lineWidth = Math.max(1, (Number(stroke.width) || 4) * dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0][0] * canvasWidth, points[0][1] * canvasHeight);
  if (points.length === 1) {
    ctx.lineTo(points[0][0] * canvasWidth + dpr, points[0][1] * canvasHeight);
  } else {
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i][0] * canvasWidth, points[i][1] * canvasHeight);
    }
  }
  ctx.stroke();
  ctx.restore();
}

export function drawDrawItLiveSegment(
  ctx,
  { previousPoint = null, points = [], color, width: strokeWidth } = {},
  { width, height, dpr = 1 } = {}
) {
  const fresh = Array.isArray(points) ? points : [];
  if (!ctx || !fresh.length) return;
  const start = previousPoint || fresh[0];
  ctx.save();
  ctx.strokeStyle = color || "#f4f4f5";
  ctx.lineWidth = Math.max(1, (Number(strokeWidth) || 4) * dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(start[0] * width, start[1] * height);
  const from = previousPoint ? 0 : 1;
  if (!previousPoint && fresh.length === 1) {
    ctx.lineTo(start[0] * width + dpr, start[1] * height);
  } else {
    for (let i = from; i < fresh.length; i += 1) {
      ctx.lineTo(fresh[i][0] * width, fresh[i][1] * height);
    }
  }
  ctx.stroke();
  ctx.restore();
}

export function paintDrawItBoard(ctx, board, { width, height, dpr = 1 } = {}) {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  for (const stroke of board?.strokes || []) {
    drawStroke(ctx, stroke, width, height, dpr);
  }
  if (board?.currentStroke) {
    drawStroke(ctx, board.currentStroke, width, height, dpr);
  }
}

/**
 * Replay read-only du snapshot durable (recap de manche).
 * Pas de pointer events, pas de Broadcast, pas de currentStroke.
 */
export function mountDrawItReplayCanvas(hostEl, { getBoard } = {}) {
  if (!hostEl) return null;

  const canvas = document.createElement("canvas");
  canvas.className = "draw-it-canvas draw-it-canvas--recap";
  canvas.setAttribute("aria-label", "Dessin final de la manche");
  canvas.style.pointerEvents = "none";
  canvas.setAttribute("aria-hidden", "false");
  hostEl.classList.add("draw-it-canvas-host--locked");
  hostEl.style.pointerEvents = "none";
  hostEl.appendChild(canvas);

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let cleaned = false;

  function recapBoard() {
    const board = getBoard?.() || {};
    return { ...board, currentStroke: null };
  }

  function paint() {
    if (cleaned) return;
    const ctx = canvas.getContext("2d");
    paintDrawItBoard(ctx, recapBoard(), {
      width: canvas.width,
      height: canvas.height,
      dpr,
    });
  }

  function sizeCanvas() {
    if (cleaned) return;
    const rect = hostEl.getBoundingClientRect();
    const nextDpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === cssW && h === cssH && nextDpr === dpr) return;
    cssW = w;
    cssH = h;
    dpr = nextDpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    paint();
  }

  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      sizeCanvas();
    });
    resizeObserver.observe(hostEl);
  }
  sizeCanvas();

  return {
    canvas,
    paint,
    isDrawing() {
      return false;
    },
    isReadOnly() {
      return true;
    },
    syncInteractive() {},
    applyLiveDelta() {},
    applyBoard() {
      if (cleaned) return;
      paint();
    },
    applySession() {
      if (cleaned) return;
      paint();
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      canvas.remove();
    },
  };
}

export function mountDrawItCanvas(hostEl, {
  getBoard,
  setBoard,
  getSession,
  getLocalUid,
  nowMs = () => Date.now(),
  getLiveState = () => null,
  onStrokeStart,
  onStrokePoints,
  onStrokeEnd,
  createStrokeId,
  getBrush,
  onDrawingChange,
} = {}) {
  if (!hostEl) return null;

  const canvas = document.createElement("canvas");
  canvas.className = "draw-it-canvas";
  canvas.setAttribute("aria-label", "Zone de dessin");
  hostEl.appendChild(canvas);

  let drawing = false;
  let pointerId = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let cleaned = false;

  function allowed() {
    return canDrawOnDrawItCanvas(getSession?.() || {}, {
      uid: getLocalUid?.() || null,
      nowMs: nowMs(),
    }).ok;
  }

  function paint() {
    const ctx = canvas.getContext("2d");
    paintDrawItBoard(ctx, getBoard(), {
      width: canvas.width,
      height: canvas.height,
      dpr,
    });
    const remote = getLiveState?.();
    for (const stroke of Object.values(remote?.remoteCompleted || {})) {
      drawStroke(ctx, stroke, canvas.width, canvas.height, dpr);
    }
    for (const stroke of Object.values(remote?.remoteInProgress || {})) {
      drawStroke(ctx, stroke, canvas.width, canvas.height, dpr);
    }
  }

  function sizeCanvas() {
    if (cleaned) return;
    const rect = hostEl.getBoundingClientRect();
    const nextDpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === cssW && h === cssH && nextDpr === dpr) return;
    cssW = w;
    cssH = h;
    dpr = nextDpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    paint();
  }

  function pointFromEvent(event) {
    return clientPointToNormalized(
      event.clientX,
      event.clientY,
      canvas.getBoundingClientRect()
    );
  }

  function onPointerDown(event) {
    if (cleaned || !allowed()) return;
    if (drawing) return;
    event.preventDefault();
    drawing = true;
    pointerId = event.pointerId;
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture optionnelle */
    }
    const next = applyDrawItPointer(
      getBoard(),
      "down",
      pointFromEvent(event),
      true,
      {
        strokeId: createStrokeId?.() || null,
        color: getBrush?.()?.color,
        width: getBrush?.()?.width,
      }
    );
    setBoard(next);
    if (next?.currentStroke) onStrokeStart?.(next.currentStroke);
    onDrawingChange?.(true);
    paint();
  }

  function onPointerMove(event) {
    if (cleaned || !drawing || event.pointerId !== pointerId) return;
    event.preventDefault();
    const ok = allowed();
    const before = getBoard();
    const strokeId = before?.currentStroke?.strokeId;
    const beforeLength = before?.currentStroke?.points?.length || 0;
    const events =
      typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [event];
    let next = before;
    for (const sample of events?.length ? events : [event]) {
      next = applyDrawItPointer(next, "move", pointFromEvent(sample), ok);
    }
    setBoard(next);
    const active = next?.currentStroke;
    if (ok && active && active.strokeId === strokeId) {
      const added = active.points.slice(beforeLength);
      if (added.length) {
        onStrokePoints?.(strokeId, added);
        drawDrawItLiveSegment(
          canvas.getContext("2d"),
          {
            previousPoint: before?.currentStroke?.points?.[beforeLength - 1] || null,
            points: added,
            color: active.color,
            width: active.width,
          },
          { width: canvas.width, height: canvas.height, dpr }
        );
      }
    }
    if (!ok) {
      drawing = false;
      pointerId = null;
      onDrawingChange?.(false);
      const completed = next?.strokes?.[next.strokes.length - 1];
      if (completed?.strokeId === strokeId) {
        onStrokeEnd?.(completed, completed.points.slice(beforeLength));
      }
      paint();
    }
  }

  function finishPointer(event) {
    if (cleaned || !drawing) return;
    if (event.pointerId != null && event.pointerId !== pointerId) return;
    event.preventDefault?.();
    drawing = false;
    pointerId = null;
    onDrawingChange?.(false);
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      /* déjà relâché */
    }
    const before = getBoard();
    const strokeId = before?.currentStroke?.strokeId;
    const beforeLength = before?.currentStroke?.points?.length || 0;
    const next = applyDrawItPointer(
      before,
      event.type === "pointercancel" ? "cancel" : "up",
      pointFromEvent(event),
      true
    );
    setBoard(next);
    const completed = next?.strokes?.[next.strokes.length - 1];
    if (completed?.strokeId === strokeId) {
      onStrokeEnd?.(completed, completed.points.slice(beforeLength));
    }
    paint();
  }

  function syncInteractive() {
    if (cleaned) return;
    const ok = allowed();
    canvas.classList.toggle("draw-it-canvas--active", ok);
    canvas.style.pointerEvents = ok ? "auto" : "none";
    canvas.style.setProperty("touch-action", "none");
    hostEl.style.setProperty("touch-action", "none");
    hostEl.classList.toggle("draw-it-canvas-host--locked", !ok);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);

  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      sizeCanvas();
    });
    resizeObserver.observe(hostEl);
  }
  sizeCanvas();
  syncInteractive();

  return {
    canvas,
    paint,
    syncInteractive,
    isDrawing() {
      return !cleaned && drawing;
    },
    applySession(session) {
      if (cleaned) return;
      setBoard(maybeResetDrawItBoard(getBoard(), session || getSession?.() || {}));
      syncInteractive();
      paint();
    },
    applyLiveDelta(delta) {
      if (cleaned || !delta) return;
      if (delta.type === "segment") {
        drawDrawItLiveSegment(
          canvas.getContext("2d"),
          {
            previousPoint: delta.previousPoint,
            points: delta.points,
            color: delta.stroke?.color,
            width: delta.stroke?.width,
          },
          { width: canvas.width, height: canvas.height, dpr }
        );
        return;
      }
      if (delta.type === "replay") paint();
    },
    cleanup() {
      if (cleaned) return;
      if (drawing) {
        const before = getBoard();
        const strokeId = before?.currentStroke?.strokeId;
        const next = applyDrawItPointer(before, "cancel", null, true);
        setBoard(next);
        const completed = next?.strokes?.[next.strokes.length - 1];
        if (completed?.strokeId === strokeId) onStrokeEnd?.(completed, []);
        drawing = false;
        pointerId = null;
      }
      cleaned = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", finishPointer);
      canvas.removeEventListener("pointercancel", finishPointer);
      canvas.remove();
    },
  };
}
