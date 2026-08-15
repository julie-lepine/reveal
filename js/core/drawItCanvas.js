/**
 * Canvas local Draw it ! T6 — Pointer Events + resize.
 * Aucun Broadcast, RPC, contribute, ni écriture de session distante.
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

export function mountDrawItCanvas(hostEl, {
  getBoard,
  setBoard,
  getSession,
  getLocalUid,
  nowMs = () => Date.now(),
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
    setBoard(applyDrawItPointer(getBoard(), "down", pointFromEvent(event), true));
    paint();
  }

  function onPointerMove(event) {
    if (cleaned || !drawing || event.pointerId !== pointerId) return;
    event.preventDefault();
    const ok = allowed();
    setBoard(applyDrawItPointer(getBoard(), "move", pointFromEvent(event), ok));
    if (!ok) {
      drawing = false;
      pointerId = null;
    }
    paint();
  }

  function finishPointer(event) {
    if (cleaned || !drawing) return;
    if (event.pointerId != null && event.pointerId !== pointerId) return;
    event.preventDefault?.();
    drawing = false;
    pointerId = null;
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      /* déjà relâché */
    }
    setBoard(applyDrawItPointer(getBoard(), event.type === "pointercancel" ? "cancel" : "up", pointFromEvent(event), true));
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
    applySession(session) {
      if (cleaned) return;
      setBoard(maybeResetDrawItBoard(getBoard(), session || getSession?.() || {}));
      syncInteractive();
      paint();
    },
    cleanup() {
      if (cleaned) return;
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
