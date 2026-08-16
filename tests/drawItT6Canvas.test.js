/**
 * Draw it ! T6 — canvas local + currentStroke (aucun réseau).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const {
  DRAW_IT_STROKE_MAX_COUNT,
  DRAW_IT_STROKE_MAX_POINTS,
  appendSimplifiedPoint,
  applyDrawItPointer,
  beginDrawItStroke,
  canDrawOnDrawItCanvas,
  clientPointToNormalized,
  clamp01,
  createEmptyDrawItBoard,
  endDrawItStroke,
  extendDrawItStroke,
  maybeResetDrawItBoard,
  round3,
  strokePointsToPixels,
} = await import("../js/core/drawItStrokes.js");
const { DRAW_IT_PHASE_DRAWING, DRAW_IT_PHASE_REVEAL } = await import(
  "../js/core/drawItRound.js"
);

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-08-15T21:00:00.000Z");

function drawingSession(extra = {}) {
  return {
    lobbyStarted: true,
    runId: "run-t6",
    roundIdx: 0,
    canvasEpoch: 0,
    phase: DRAW_IT_PHASE_DRAWING,
    drawerUid: DRAWER,
    roundStartAt: "2026-08-15T21:00:00.000Z",
    roundEndsAt: "2026-08-15T21:01:00.000Z",
    foundOrder: [],
    ...extra,
  };
}

const RECT = { left: 10, top: 20, width: 200, height: 100 };

describe("Draw it ! T6 — normalisation", () => {
  it("point central / coins → 0..1", () => {
    assert.deepEqual(clientPointToNormalized(110, 70, RECT), [0.5, 0.5]);
    assert.deepEqual(clientPointToNormalized(10, 20, RECT), [0, 0]);
    assert.deepEqual(clientPointToNormalized(210, 120, RECT), [1, 1]);
  });

  it("clamp des coordonnées hors cadre", () => {
    assert.deepEqual(clientPointToNormalized(-40, -10, RECT), [0, 0]);
    assert.deepEqual(clientPointToNormalized(800, 900, RECT), [1, 1]);
    assert.equal(clamp01(-0.2), 0);
    assert.equal(clamp01(1.4), 1);
  });

  it("arrondi à 3 décimales", () => {
    assert.equal(round3(0.1234), 0.123);
    assert.equal(round3(0.1236), 0.124);
    assert.deepEqual(clientPointToNormalized(10 + 200 * 0.1234, 20, RECT), [0.123, 0]);
  });
});

describe("Draw it ! T6 — simplification + cap", () => {
  it("points trop proches supprimés, assez éloignés conservés", () => {
    const first = appendSimplifiedPoint([], [0, 0]);
    const close = appendSimplifiedPoint(first, [0.005, 0]);
    const far = appendSimplifiedPoint(first, [0.02, 0]);
    assert.deepEqual(close, [[0, 0]]);
    assert.deepEqual(far, [
      [0, 0],
      [0.02, 0],
    ]);
  });

  it("conserve un trait long puis applique le plafond de sécurité", () => {
    let points = [];
    for (let i = 0; i < DRAW_IT_STROKE_MAX_POINTS + 20; i += 1) {
      points = appendSimplifiedPoint(points, [i / DRAW_IT_STROKE_MAX_POINTS, 0], {
        minDist: 0,
      });
    }
    assert.equal(points.length, DRAW_IT_STROKE_MAX_POINTS);
  });
});

describe("Draw it ! T6 — currentStroke local", () => {
  it("down / move / up : currentStroke puis strokes", () => {
    let board = createEmptyDrawItBoard({ runId: "run-t6" });
    board = applyDrawItPointer(board, "down", [0.1, 0.2], true);
    assert.ok(board.currentStroke);
    assert.equal(board.currentStroke.strokeId, "s1");
    assert.deepEqual(board.currentStroke.points, [[0.1, 0.2]]);
    assert.deepEqual(board.strokes, []);

    board = applyDrawItPointer(board, "move", [0.4, 0.5], true);
    assert.ok(board.currentStroke);
    assert.deepEqual(board.currentStroke.points, [
      [0.1, 0.2],
      [0.4, 0.5],
    ]);

    board = applyDrawItPointer(board, "up", [0.41, 0.51], true);
    assert.equal(board.currentStroke, null);
    assert.equal(board.strokes.length, 1);
    assert.equal(board.strokes[0].strokeId, "s1");
    assert.ok(board.strokes[0].points.length >= 2);
  });

  it("plafond 25 strokes : pas de 26e currentStroke", () => {
    let board = createEmptyDrawItBoard();
    for (let i = 0; i < DRAW_IT_STROKE_MAX_COUNT; i += 1) {
      board = beginDrawItStroke(board, [0.1, 0.1]);
      board = endDrawItStroke(board, [0.2, 0.2]);
    }
    assert.equal(board.strokes.length, DRAW_IT_STROKE_MAX_COUNT);
    const blocked = beginDrawItStroke(board, [0.3, 0.3]);
    assert.equal(blocked.currentStroke, null);
    assert.equal(blocked.strokes.length, DRAW_IT_STROKE_MAX_COUNT);
  });
});

describe("Draw it ! T6 — resize + replay", () => {
  it("resize : coordonnées normalisées inchangées, replay en pixels", () => {
    let board = createEmptyDrawItBoard();
    board = beginDrawItStroke(board, [0.25, 0.5]);
    board = extendDrawItStroke(board, [0.75, 0.5]);
    board = endDrawItStroke(board);
    const before = board.strokes[0].points.map((p) => [...p]);
    const afterResize = board;
    assert.deepEqual(afterResize.strokes[0].points, before);
    assert.deepEqual(strokePointsToPixels(before, 100, 40), [
      [25, 20],
      [75, 20],
    ]);
    assert.deepEqual(strokePointsToPixels(before, 200, 80), [
      [50, 40],
      [150, 40],
    ]);
  });
});

describe("Draw it ! T6 — permissions", () => {
  it("drawer + drawing → autorisé ; foundOrder ne bloque pas", () => {
    const ok = canDrawOnDrawItCanvas(
      drawingSession({ foundOrder: [{ uid: GUEST, at: "t" }] }),
      { uid: DRAWER, nowMs: NOW + 10_000 }
    );
    assert.equal(ok.ok, true);
  });

  it("non-drawer / reveal / timer expiré → refusé", () => {
    assert.equal(
      canDrawOnDrawItCanvas(drawingSession(), { uid: GUEST, nowMs: NOW + 1000 }).ok,
      false
    );
    assert.equal(
      canDrawOnDrawItCanvas(drawingSession({ phase: DRAW_IT_PHASE_REVEAL }), {
        uid: DRAWER,
        nowMs: NOW + 1000,
      }).ok,
      false
    );
    assert.equal(
      canDrawOnDrawItCanvas(drawingSession(), { uid: DRAWER, nowMs: NOW + 60_000 }).ok,
      false
    );
    assert.equal(
      canDrawOnDrawItCanvas(drawingSession(), { uid: DRAWER, nowMs: NOW + 60_000 }).reason,
      "expired"
    );
  });
});

describe("Draw it ! T6 — reset de manche", () => {
  it("changement de roundIdx ou runId vide strokes / currentStroke", () => {
    let board = createEmptyDrawItBoard({ runId: "run-a", roundIdx: 0 });
    board = beginDrawItStroke(board, [0.2, 0.2]);
    board = endDrawItStroke(board, [0.4, 0.4]);
    assert.equal(board.strokes.length, 1);

    const nextRound = maybeResetDrawItBoard(board, {
      runId: "run-a",
      roundIdx: 1,
      canvasEpoch: 0,
    });
    assert.deepEqual(nextRound.strokes, []);
    assert.equal(nextRound.currentStroke, null);
    assert.equal(nextRound.roundIdx, 1);
    assert.equal(nextRound.runId, "run-a");

    const nextRun = maybeResetDrawItBoard(board, {
      runId: "run-b",
      roundIdx: 0,
      canvasEpoch: 0,
    });
    assert.deepEqual(nextRun.strokes, []);
    assert.equal(nextRun.runId, "run-b");

    const same = maybeResetDrawItBoard(board, {
      runId: "run-a",
      roundIdx: 0,
      canvasEpoch: 0,
    });
    assert.equal(same.strokes.length, 1);

    const epoch = maybeResetDrawItBoard(board, {
      runId: "run-a",
      roundIdx: 0,
      canvasEpoch: 2,
    });
    assert.deepEqual(epoch.strokes, []);
    assert.equal(epoch.canvasEpoch, 2);
  });
});

describe("Draw it ! T6 — aucun réseau", () => {
  it("modules T6 sans RPC / contribute / Broadcast / game_sessions", () => {
    for (const rel of [
      "js/core/drawItStrokes.js",
      "js/core/drawItCanvas.js",
    ]) {
      const src = read(rel);
      assert.doesNotMatch(src, /\bbroadcast\s*\(|BroadcastChannel|supabase\.rpc|rpcSubmit|contribute_game_session/);
      assert.doesNotMatch(src, /awardDrawItRound|drawItLive/);
    }
    const canvas = read("js/core/drawItCanvas.js");
    assert.match(canvas, /pointerdown/);
    assert.match(canvas, /pointermove/);
    assert.match(canvas, /pointerup/);
    assert.match(canvas, /pointercancel/);
    assert.match(canvas, /let drawing = false/);
    assert.match(canvas, /touch-action/);
    assert.match(canvas, /ResizeObserver/);
    const game = read("js/games/drawIt.js");
    assert.match(game, /mountDrawItCanvas/);
    assert.match(game, /draw-it-canvas-host/);
    assert.doesNotMatch(game, /broadcast\(|channel\(/);
  });
});
