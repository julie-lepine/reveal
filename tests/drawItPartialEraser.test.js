/**
 * Draw it ! — gomme partielle vectorielle (FEATURE-DRAWIT-06).
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HOST = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const strokes = await import("../js/core/drawItStrokes.js");
const live = await import("../js/core/drawItLive.js");

const {
  DRAW_IT_DURABLE_STROKE_MAX_POINTS,
  DRAW_IT_STROKE_MAX_COUNT,
  DRAW_IT_TOOL_DRAW,
  DRAW_IT_TOOL_ERASE,
  applyDrawItBoardClear,
  applyDrawItBoardEraseSegments,
  applyDrawItDurableClear,
  applyDrawItDurableEraseSegments,
  applyDrawItPointer,
  canPersistDrawItStroke,
  computeDrawItPartialErase,
  createDrawItBrush,
  createDrawItEraseOperationId,
  createDrawItRecapBoardFromSession,
  createEmptyDrawItBoard,
  drawItEraserRadius,
  endDrawItStroke,
  mergeDrawItDurableSnapshot,
  splitStrokeByErasePath,
  undoLastCompletedDrawItStroke,
} = strokes;

function session(extra = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-partial",
    roundIdx: 0,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    strokeSeq: 1,
    strokes: [],
    ...extra,
  };
}

function stroke(id, extra = {}) {
  return {
    strokeId: id,
    seq: extra.seq ?? (Number(String(id).replace(/\D/g, "")) || 1),
    canvasEpoch: extra.canvasEpoch ?? 0,
    color: extra.color || "#ef4444",
    width: extra.width ?? 4,
    points: extra.points || [
      [0.05, 0.5],
      [0.95, 0.5],
    ],
    ...extra,
  };
}

function eraseMiddle(target = stroke("s1"), extra = {}) {
  return computeDrawItPartialErase(
    extra.strokes || [target],
    extra.erasePoints || [[0.5, 0.5]],
    extra.radius ?? drawItEraserRadius(4),
    { operationId: extra.operationId || "e-mid" }
  );
}

function payload(type, extra = {}) {
  const base = {
    type,
    runId: "run-partial",
    roundIdx: 0,
    canvasEpoch: extra.canvasEpoch ?? 0,
    drawerUid: DRAWER,
  };
  if (type === "erase_segments") {
    return {
      ...base,
      operationId: extra.operationId || "e-mid",
      replacements: extra.replacements || eraseMiddle().replacements,
      ...extra,
      type,
    };
  }
  return { ...base, ...extra, type };
}

describe("Draw it ! gomme partielle — géométrie", () => {
  it("A. gomme au milieu d'un trait horizontal → deux fragments", () => {
    const line = stroke("s1");
    const split = splitStrokeByErasePath(line, [[0.5, 0.5]], drawItEraserRadius(4));
    assert.equal(split.unchanged, false);
    assert.equal(split.fragments.length, 2);
    const leftMax = Math.max(...split.fragments[0].map((p) => p[0]));
    const rightMin = Math.min(...split.fragments[1].map((p) => p[0]));
    assert.ok(leftMax < 0.5);
    assert.ok(rightMin > 0.5);
    const board = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [line] },
      eraseMiddle(line).replacements
    );
    assert.equal(board.strokes.length, 2);
    assert.equal(board.strokes.some((entry) => entry.strokeId === "s1"), false);
  });

  it("B. gomme au début → seule la partie restante", () => {
    const split = splitStrokeByErasePath(
      stroke("s1"),
      [[0.05, 0.5], [0.08, 0.5]],
      drawItEraserRadius(12)
    );
    assert.equal(split.unchanged, false);
    assert.equal(split.fragments.length, 1);
    const minX = Math.min(...split.fragments[0].map((p) => p[0]));
    assert.ok(minX > 0.05);
  });

  it("C. gomme à la fin → seule la partie initiale", () => {
    const split = splitStrokeByErasePath(
      stroke("s1"),
      [[0.95, 0.5], [0.92, 0.5]],
      drawItEraserRadius(12)
    );
    assert.equal(split.unchanged, false);
    assert.equal(split.fragments.length, 1);
    const maxX = Math.max(...split.fragments[0].map((p) => p[0]));
    assert.ok(maxX < 0.95);
  });

  it("D. gomme complète → le stroke disparaît", () => {
    const short = stroke("s1", { points: [[0.49, 0.5], [0.51, 0.5]] });
    const split = splitStrokeByErasePath(short, [[0.5, 0.5]], drawItEraserRadius(12));
    assert.equal(split.unchanged, false);
    assert.deepEqual(split.fragments, []);
  });

  it("E. deux strokes touchés sont découpés indépendamment", () => {
    const h = stroke("h", { points: [[0.1, 0.5], [0.9, 0.5]] });
    const v = stroke("v", {
      seq: 2,
      points: [
        [0.5, 0.1],
        [0.5, 0.9],
      ],
    });
    const mutation = computeDrawItPartialErase(
      [h, v],
      [[0.5, 0.5]],
      drawItEraserRadius(7),
      { operationId: "e-cross" }
    );
    assert.equal(mutation.replacements.length, 2);
    const board = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [h, v] },
      mutation.replacements
    );
    assert.ok(board.strokes.length >= 4);
    assert.equal(board.strokes.some((entry) => entry.strokeId === "h"), false);
    assert.equal(board.strokes.some((entry) => entry.strokeId === "v"), false);
  });

  it("F. stroke hors zone inchangé", () => {
    const far = stroke("s2", {
      seq: 2,
      points: [
        [0.1, 0.1],
        [0.2, 0.1],
      ],
    });
    const line = stroke("s1");
    const mutation = computeDrawItPartialErase(
      [line, far],
      [[0.5, 0.5]],
      drawItEraserRadius(4),
      { operationId: "e-far" }
    );
    assert.equal(mutation.replacements.some((entry) => entry.sourceStrokeId === "s2"), false);
    const board = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [line, far] },
      mutation.replacements
    );
    const kept = board.strokes.find((entry) => entry.strokeId === "s2");
    assert.deepEqual(kept.points, far.points);
  });

  it("G. fragments conservent la couleur", () => {
    const pink = stroke("s1", { color: "#ff69b4" });
    const board = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [pink] },
      eraseMiddle(pink).replacements
    );
    assert.ok(board.strokes.length >= 1);
    assert.ok(board.strokes.every((entry) => entry.color === "#ff69b4"));
  });

  it("H. fragments conservent l'épaisseur", () => {
    const thick = stroke("s1", { width: 12 });
    const board = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [thick] },
      eraseMiddle(thick, { radius: drawItEraserRadius(4) }).replacements
    );
    assert.ok(board.strokes.every((entry) => entry.width === 12));
  });

  it("I. second passage ne ressuscite pas les portions gommées", () => {
    const line = stroke("s1");
    let board = {
      ...createEmptyDrawItBoard(),
      strokes: [line],
    };
    board = applyDrawItBoardEraseSegments(board, eraseMiddle(line, { operationId: "e1" }).replacements);
    assert.ok(board.strokes.length >= 1);
    const second = computeDrawItPartialErase(
      board.strokes,
      [[0.2, 0.5]],
      drawItEraserRadius(4),
      { operationId: "e2" }
    );
    board = applyDrawItBoardEraseSegments(board, second.replacements);
    assert.equal(board.strokes.some((entry) => entry.strokeId === "s1"), false);
    for (const entry of board.strokes) {
      assert.equal(
        entry.points.some((point) => Math.abs(point[0] - 0.5) < 0.02),
        false
      );
    }
  });
});

describe("Draw it ! gomme partielle — live / durable / recap", () => {
  it("J. Broadcast erase_segments appliqué chez l'observateur", () => {
    const s = session();
    const line = stroke("s1");
    const mutation = eraseMiddle(line);
    const drawer = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [line] },
      mutation.replacements
    );
    let state = live.createDrawItLiveState(s);
    state = {
      ...state,
      remoteCompleted: {
        s1: {
          strokeId: "s1",
          points: line.points,
          color: line.color,
          width: line.width,
          lastSeq: line.seq,
        },
      },
    };
    const result = live.applyDrawItLiveEvent(
      state,
      payload("erase_segments", mutation),
      s
    );
    assert.equal(result.applied, true);
    assert.equal(result.delta.action, "erase_segments");
    assert.equal(result.state.remoteCompleted.s1, undefined);
    const observerIds = Object.keys(result.state.remoteCompleted).sort();
    assert.deepEqual(
      observerIds,
      drawer.strokes.map((entry) => entry.strokeId).sort()
    );
  });

  it("K. persistence + hydration identiques", () => {
    const line = stroke("s1");
    const mutation = eraseMiddle(line);
    const applied = applyDrawItDurableEraseSegments(session({ strokes: [line] }), mutation.replacements, {
      uid: DRAWER,
      operationId: mutation.operationId,
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.session.strokes.some((entry) => entry.strokeId === "s1"), false);
    assert.ok(applied.session.strokes.length >= 1);
    const recap = createDrawItRecapBoardFromSession(applied.session);
    assert.deepEqual(
      recap.strokes.map((entry) => entry.strokeId),
      applied.session.strokes.map((entry) => entry.strokeId)
    );
  });

  it("L. retry idempotent", () => {
    const line = stroke("s1");
    const mutation = eraseMiddle(line, { operationId: "e-retry" });
    const first = applyDrawItDurableEraseSegments(session({ strokes: [line] }), mutation.replacements, {
      uid: DRAWER,
      operationId: "e-retry",
    });
    const retry = applyDrawItDurableEraseSegments(first.session, mutation.replacements, {
      uid: DRAWER,
      operationId: "e-retry",
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.skipped, true);
    assert.equal(retry.session.strokes.length, first.session.strokes.length);
  });

  it("M. Clear après gomme : aucune résurrection", () => {
    const line = stroke("s1");
    const erased = applyDrawItDurableEraseSegments(session({ strokes: [line] }), eraseMiddle(line).replacements, {
      uid: DRAWER,
      operationId: "e-clear",
    }).session;
    const cleared = applyDrawItDurableClear(erased, { uid: DRAWER, canvasEpoch: 0 });
    assert.deepEqual(cleared.session.strokes, []);
    assert.equal(cleared.session.canvasEpoch, 1);
    const board = applyDrawItBoardClear(
      applyDrawItBoardEraseSegments(
        { ...createEmptyDrawItBoard(), strokes: [line] },
        eraseMiddle(line).replacements
      ),
      1
    );
    assert.deepEqual(board.strokes, []);
  });

  it("N. epoch stale refusée", () => {
    const result = applyDrawItDurableEraseSegments(
      session({ strokes: [stroke("s1")], canvasEpoch: 2 }),
      eraseMiddle().replacements,
      { uid: DRAWER, operationId: "e-epoch", canvasEpoch: 0 }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "stale_epoch");
  });

  it("O. run stale : live et durable refusent", () => {
    const s = session();
    const result = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("erase_segments", { runId: "old-run" }),
      s
    );
    assert.equal(result.applied, false);
    const durable = applyDrawItDurableEraseSegments(
      s,
      eraseMiddle().replacements,
      { uid: DRAWER, operationId: "e-run", runId: "old-run" }
    );
    assert.equal(durable.ok, false);
    assert.equal(durable.reason, "stale_run");
  });

  it("P. round stale : live et durable refusent", () => {
    const s = session();
    const result = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("erase_segments", { roundIdx: 9 }),
      s
    );
    assert.equal(result.applied, false);
    const durable = applyDrawItDurableEraseSegments(
      s,
      eraseMiddle().replacements,
      { uid: DRAWER, operationId: "e-round", roundIdx: 9 }
    );
    assert.equal(durable.ok, false);
    assert.equal(durable.reason, "stale_round");
  });

  it("Q. recap lit les fragments durables", () => {
    const applied = applyDrawItDurableEraseSegments(
      session({ strokes: [stroke("s1", { color: "#12abef" })] }),
      eraseMiddle(stroke("s1", { color: "#12abef" })).replacements,
      { uid: DRAWER, operationId: "e-recap" }
    ).session;
    const recap = createDrawItRecapBoardFromSession(applied);
    assert.equal(recap.currentStroke, null);
    assert.ok(recap.strokes.length >= 1);
    assert.equal(recap.strokes.some((entry) => entry.strokeId === "s1"), false);
    assert.ok(recap.strokes.every((entry) => entry.color === "#12abef"));
  });

  it("R. reconnexion : snapshot durable sans portions gommées", () => {
    const line = stroke("s1");
    const durable = applyDrawItDurableEraseSegments(session({ strokes: [line] }), eraseMiddle(line).replacements, {
      uid: DRAWER,
      operationId: "e-re",
    }).session;
    const merged = mergeDrawItDurableSnapshot(
      { strokes: [line], canvasEpoch: 0, suppressedStrokeIds: [] },
      durable
    );
    assert.equal(merged.strokes.some((entry) => entry.strokeId === "s1"), false);
    assert.ok(merged.strokes.length >= 1);
  });

  it("S. Undo après gomme partielle retire le dernier fragment, sans restaurer le milieu", () => {
    const line = stroke("s1");
    const board = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [line] },
      eraseMiddle(line).replacements
    );
    assert.ok(board.strokes.length >= 2);
    const undone = undoLastCompletedDrawItStroke(board);
    assert.equal(undone.strokes.length, board.strokes.length - 1);
    assert.equal(undone.strokes.some((entry) => entry.strokeId === "s1"), false);
    for (const entry of undone.strokes) {
      assert.equal(
        entry.points.some((point) => Math.abs(point[0] - 0.5) < 0.02),
        false
      );
    }
  });
});

describe("Draw it ! gomme partielle — caps / sécurité", () => {
  it("T. cap 25 : une gomme ne crée pas plus de 25 strokes", () => {
    const many = Array.from({ length: 24 }, (_, i) =>
      stroke(`keep${i}`, {
        seq: i + 1,
        points: [
          [0.01, 0.01 + i * 0.01],
          [0.02, 0.01 + i * 0.01],
        ],
      })
    );
    const line = stroke("s1", { seq: 25 });
    const mutation = computeDrawItPartialErase(
      [...many, line],
      [[0.5, 0.5]],
      drawItEraserRadius(4),
      { operationId: "e-cap" }
    );
    const board = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [...many, line] },
      mutation.replacements
    );
    assert.ok(board.strokes.length <= DRAW_IT_STROKE_MAX_COUNT);
  });

  it("U. aucun fragment au-delà de 80 points", () => {
    const dense = Array.from({ length: 200 }, (_, i) => [i / 199, 0.5]);
    const line = stroke("s1", { points: dense });
    const mutation = eraseMiddle(line);
    for (const entry of mutation.replacements) {
      for (const fragment of entry.fragments) {
        assert.ok(fragment.points.length <= DRAW_IT_DURABLE_STROKE_MAX_POINTS);
      }
    }
  });

  it("V. non-drawer refusé", () => {
    const gate = canPersistDrawItStroke(session(), GUEST);
    assert.equal(gate.ok, false);
    const applied = applyDrawItDurableEraseSegments(
      session({ strokes: [stroke("s1")] }),
      eraseMiddle().replacements,
      { uid: GUEST, operationId: "e-guest" }
    );
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "not_drawer");
  });

  it("W. acting host non-drawer refusé", () => {
    const applied = applyDrawItDurableEraseSegments(
      session({ strokes: [stroke("s1")] }),
      eraseMiddle().replacements,
      { uid: HOST, operationId: "e-host" }
    );
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "not_drawer");
  });

  it("X. acting host drawer autorisé", () => {
    const applied = applyDrawItDurableEraseSegments(
      session({ drawerUid: HOST, strokes: [stroke("s1")] }),
      eraseMiddle().replacements,
      { uid: HOST, operationId: "e-host-draw" }
    );
    assert.equal(applied.ok, true);
    assert.equal(applied.skipped, false);
  });

  it("geste gomme ne crée pas de stroke blanc", () => {
    let board = createEmptyDrawItBoard({ runId: "run-partial" });
    board = { ...board, strokes: [stroke("s1")] };
    board = applyDrawItPointer(board, "down", [0.5, 0.5], true, {
      ...createDrawItBrush({ tool: DRAW_IT_TOOL_ERASE, width: 7 }),
    });
    board = endDrawItStroke(board, [0.52, 0.5]);
    assert.equal(board.currentStroke, null);
    assert.equal(
      board.strokes.some((entry) => String(entry.color || "").includes("255,255,255")),
      false
    );
    assert.ok(createDrawItEraseOperationId().startsWith("e:"));
  });

  it("RPC dédiée, FOR UPDATE, pas de replace générique", () => {
    const sql = read("supabase/feature-drawit-06-partial-erase.sql");
    assert.match(sql, /erase_drawit_segments/);
    assert.match(sql, /for update/i);
    assert.match(sql, /auth\.uid\(\)/);
    assert.match(sql, /eraseOpIds/);
    assert.match(sql, /DRAWIT_STALE_RUN/);
    assert.match(sql, /DRAWIT_STALE_ROUND/);
    assert.match(sql, /DRAWIT_STALE_EPOCH/);
    assert.match(sql, /DRAWIT_NOT_DRAWER/);
    assert.doesNotMatch(sql, /p_strokes jsonb/);
    assert.match(sql, /drawit_sanitize_completed_stroke/);
    const rpc = read("js/core/gameSessionRpc.js");
    assert.match(rpc, /rpcEraseDrawItSegments/);
    const sessionSrc = read("js/core/drawItSession.js");
    assert.match(sessionSrc, /commitDrawItEraseSegments/);
    const liveSrc = read("js/core/drawItLive.js");
    assert.match(liveSrc, /erase_segments/);
    assert.match(liveSrc, /drawit:\$\{intent\.lobbyId\}/);
  });
});

function fakeCanvasCtx() {
  return {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    clearRect() {},
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "",
    lineJoin: "",
  };
}

function installFakeCanvasHost() {
  const listeners = {};
  const canvas = {
    className: "",
    style: {
      pointerEvents: "auto",
      width: "",
      height: "",
      setProperty() {},
    },
    classList: { add() {}, toggle() {}, remove() {} },
    width: 100,
    height: 100,
    getContext: () => fakeCanvasCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeEventListener(type) {
      delete listeners[type];
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    setAttribute() {},
    remove() {},
  };
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = { createElement: () => canvas };
  globalThis.window = { ...(prevWin || {}), devicePixelRatio: 1 };
  const host = {
    appendChild() {},
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    classList: { add() {}, toggle() {}, remove() {} },
    style: { setProperty() {}, pointerEvents: "" },
  };
  return {
    host,
    listeners,
    restore() {
      if (prevDoc === undefined) delete globalThis.document;
      else globalThis.document = prevDoc;
      if (prevWin === undefined) delete globalThis.window;
      else globalThis.window = prevWin;
    },
  };
}

function pointerEvent(type, x, y, pointerId = 1) {
  return {
    type,
    pointerId,
    clientX: x,
    clientY: y,
    preventDefault() {},
    getCoalescedEvents() {
      return [
        {
          type: "pointermove",
          pointerId,
          clientX: x,
          clientY: y,
          preventDefault() {},
        },
      ];
    },
  };
}

describe("Draw it ! régression T06 — toolbar + canvas actifs", () => {
  it("1. toolbar mount : color picker + widths + eraser sont bindés", () => {
    const game = read("js/games/drawIt.js");
    const bindStart = game.indexOf("function bindTools()");
    const bind = game.slice(bindStart, game.indexOf("function guessChatHtml"));
    assert.ok(bindStart >= 0);
    assert.match(bind, /#draw-it-color-input/);
    assert.match(bind, /data-width/);
    assert.match(bind, /draw-it-erase/);
    assert.match(bind, /draw-it-undo/);
    assert.match(bind, /draw-it-clear/);
    assert.match(game, /id="draw-it-color-input"/);
    assert.match(game, /data-width="\$\{entry\.value\}"/);
  });

  it("2. width click : Fin 4 / Moyen 7 / Épais 12, sans forcer erase", () => {
    assert.equal(createDrawItBrush({ width: 4, tool: DRAW_IT_TOOL_DRAW }).width, 4);
    assert.equal(createDrawItBrush({ width: 7, tool: DRAW_IT_TOOL_DRAW }).width, 7);
    assert.equal(createDrawItBrush({ width: 12, tool: DRAW_IT_TOOL_DRAW }).width, 12);
    const game = read("js/games/drawIt.js");
    assert.match(
      game,
      /width: Number\(target\.getAttribute\("data-width"\)\),\s*tool: brush\.tool/
    );
  });

  it("3. color picker : changement de couleur met à jour brush.color", () => {
    const next = createDrawItBrush({
      color: "#12abef",
      width: 7,
      tool: DRAW_IT_TOOL_DRAW,
    });
    assert.equal(next.color, "#12abef");
    assert.equal(next.tool, DRAW_IT_TOOL_DRAW);
    const game = read("js/games/drawIt.js");
    assert.match(game, /color: colorInput\.value/);
    assert.match(game, /tool: brush\.tool/);
  });

  it("4. eraser toggle : draw → erase → draw", () => {
    let brush = createDrawItBrush({ tool: DRAW_IT_TOOL_DRAW });
    assert.equal(brush.tool, DRAW_IT_TOOL_DRAW);
    brush = createDrawItBrush({
      color: brush.color,
      width: brush.width,
      tool: brush.tool === DRAW_IT_TOOL_ERASE ? DRAW_IT_TOOL_DRAW : DRAW_IT_TOOL_ERASE,
    });
    assert.equal(brush.tool, DRAW_IT_TOOL_ERASE);
    brush = createDrawItBrush({
      color: brush.color,
      width: brush.width,
      tool: brush.tool === DRAW_IT_TOOL_ERASE ? DRAW_IT_TOOL_DRAW : DRAW_IT_TOOL_ERASE,
    });
    assert.equal(brush.tool, DRAW_IT_TOOL_DRAW);
  });

  it("5. draw gesture : pointerdown/move/up produit un stroke", () => {
    let board = createEmptyDrawItBoard({ runId: "run-partial" });
    const brush = createDrawItBrush({ tool: DRAW_IT_TOOL_DRAW, color: "#ef4444", width: 4 });
    board = applyDrawItPointer(board, "down", [0.1, 0.2], true, brush);
    assert.equal(board.currentStroke?.tool, DRAW_IT_TOOL_DRAW);
    board = applyDrawItPointer(board, "move", [0.3, 0.4], true);
    board = applyDrawItPointer(board, "up", [0.31, 0.41], true);
    assert.equal(board.currentStroke, null);
    assert.equal(board.strokes.length, 1);
    assert.equal(board.strokes[0].color, "#ef4444");
    assert.equal(board.strokes[0].tool, DRAW_IT_TOOL_DRAW);
  });

  it("6. erase gesture : ne produit pas de stroke de dessin", () => {
    let board = {
      ...createEmptyDrawItBoard({ runId: "run-partial" }),
      strokes: [stroke("s1")],
    };
    board = applyDrawItPointer(board, "down", [0.5, 0.5], true, {
      ...createDrawItBrush({ tool: DRAW_IT_TOOL_ERASE, width: 7 }),
    });
    assert.equal(board.currentStroke?.tool, DRAW_IT_TOOL_ERASE);
    board = applyDrawItPointer(board, "up", [0.52, 0.5], true);
    assert.equal(board.currentStroke, null);
    assert.equal(board.strokes.some((entry) => entry.tool === DRAW_IT_TOOL_ERASE), false);
    assert.equal(board.strokes.some((entry) => entry.strokeId === "s1"), false);
  });

  it("7. eraser → draw : après une gomme, le mode draw dessine immédiatement", () => {
    let board = {
      ...createEmptyDrawItBoard({ runId: "run-partial" }),
      strokes: [stroke("s1")],
    };
    board = applyDrawItPointer(board, "down", [0.5, 0.5], true, {
      ...createDrawItBrush({ tool: DRAW_IT_TOOL_ERASE, width: 7 }),
    });
    board = applyDrawItPointer(board, "up", [0.52, 0.5], true);
    const afterErase = board.strokes.length;
    board = applyDrawItPointer(
      board,
      "down",
      [0.1, 0.8],
      true,
      createDrawItBrush({ tool: DRAW_IT_TOOL_DRAW, color: "#38bdf8", width: 4 })
    );
    board = applyDrawItPointer(board, "up", [0.2, 0.8], true);
    assert.equal(board.currentStroke, null);
    assert.ok(board.strokes.length > afterErase);
    assert.equal(board.strokes.at(-1).color, "#38bdf8");
    assert.equal(board.strokes.at(-1).tool, DRAW_IT_TOOL_DRAW);
  });

  it("8. toolbar independence : isDrawing() ne bloque pas color/width/draw", async () => {
    const canvasSrc = read("js/core/drawItCanvas.js");
    assert.match(canvasSrc, /let drawing = false;/);
    const game = read("js/games/drawIt.js");
    assert.match(game, /canvasCtl\?\.isDrawing\(\)/);
    const { mountDrawItCanvas } = await import("../js/core/drawItCanvas.js");
    const fake = installFakeCanvasHost();
    let board = createEmptyDrawItBoard({ runId: "run-partial" });
    const drawingSession = session({ roundEndsAt: "2099-01-01T00:00:00.000Z" });
    try {
      const ctl = mountDrawItCanvas(fake.host, {
        getBoard: () => board,
        setBoard: (next) => {
          board = next;
        },
        getSession: () => drawingSession,
        getLocalUid: () => DRAWER,
        getBrush: () => createDrawItBrush({ tool: DRAW_IT_TOOL_DRAW }),
        createStrokeId: () => "live-1",
      });
      assert.equal(ctl.isDrawing(), false);
      fake.listeners.pointerdown(pointerEvent("pointerdown", 20, 20));
      assert.equal(ctl.isDrawing(), true);
      assert.equal(board.currentStroke?.tool, DRAW_IT_TOOL_DRAW);
      fake.listeners.pointermove(pointerEvent("pointermove", 40, 40));
      fake.listeners.pointerup(pointerEvent("pointerup", 41, 41));
      assert.equal(ctl.isDrawing(), false);
      assert.equal(board.strokes.length, 1);
      ctl.cleanup();
    } finally {
      fake.restore();
    }
  });
});
