/**
 * Draw it ! T9-FIX — rendu read-only du dessin final sur le recap de manche.
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

const strokes = await import("../js/core/drawItStrokes.js");
const { paintDrawItBoard } = await import("../js/core/drawItCanvas.js");
const {
  buildDrawItRoundRecap,
  canKeepDrawItRecapCanvas,
} = await import("../js/core/drawItRoundRecap.js");
const { applyDrawItNextRound, DRAW_IT_PHASE_REVEAL } = await import(
  "../js/core/drawItRound.js"
);

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function stroke(id, extra = {}) {
  return {
    strokeId: id,
    seq: extra.seq ?? (Number(String(id).replace(/\D/g, "")) || 1),
    canvasEpoch: extra.canvasEpoch ?? 0,
    color: extra.color || "#f4f4f5",
    width: extra.width ?? 4,
    points: extra.points || [
      [0.1, 0.1],
      [0.2, 0.2],
    ],
  };
}

function drawingSession(extra = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-t9-recap",
    roundIdx: 0,
    roundCount: 3,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    drawerOrder: [DRAWER, GUEST],
    strokeSeq: 0,
    strokes: [],
    foundOrder: [],
    ...extra,
  };
}

function revealSession(extra = {}) {
  return drawingSession({
    phase: DRAW_IT_PHASE_REVEAL,
    lastRound: {
      roundIdx: extra.roundIdx ?? 0,
      drawerUid: DRAWER,
      wordLabel: "chat",
      foundOrder: extra.foundOrder || [],
      deltas: extra.deltas || {},
    },
    ...extra,
  });
}

function recordingCtx() {
  const ops = [];
  const ctx = {
    ops,
    save() {
      ops.push("save");
    },
    restore() {
      ops.push("restore");
    },
    beginPath() {
      ops.push("beginPath");
    },
    moveTo(x, y) {
      ops.push(["moveTo", x, y]);
    },
    lineTo(x, y) {
      ops.push(["lineTo", x, y]);
    },
    stroke() {
      ops.push("stroke");
    },
    clearRect() {
      ops.push("clear");
    },
  };
  let strokeStyle = "";
  let lineWidth = 0;
  Object.defineProperty(ctx, "strokeStyle", {
    get() {
      return strokeStyle;
    },
    set(value) {
      strokeStyle = value;
      ops.push(["style", value]);
    },
  });
  Object.defineProperty(ctx, "lineWidth", {
    get() {
      return lineWidth;
    },
    set(value) {
      lineWidth = value;
      ops.push(["width", value]);
    },
  });
  Object.defineProperty(ctx, "lineCap", {
    get() {
      return "round";
    },
    set() {},
  });
  Object.defineProperty(ctx, "lineJoin", {
    get() {
      return "round";
    },
    set() {},
  });
  return ctx;
}

describe("Draw it ! T9 recap — reconstruction durable", () => {
  it("A. recap avec strokes reconstruit s1/s2/s3 depuis la session", () => {
    const session = revealSession({
      strokeSeq: 3,
      strokes: [
        stroke("s1", { seq: 1 }),
        stroke("s2", { seq: 2, points: [[0.3, 0.3], [0.4, 0.4]] }),
        stroke("s3", { seq: 3, points: [[0.5, 0.5], [0.6, 0.6]] }),
      ],
    });
    const board = strokes.createDrawItRecapBoardFromSession(session);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s2", "s3"]
    );
    assert.equal(board.currentStroke, null);
    assert.equal(board.roundIdx, 0);
    assert.equal(board.canvasEpoch, 0);
    assert.equal(board.runId, "run-t9-recap");
  });

  it("B. read-only : pas de dessin, pas de currentStroke, canvas recap sans pointers", () => {
    const session = revealSession({
      strokes: [stroke("s1")],
      strokeSeq: 1,
    });
    const board = strokes.createDrawItRecapBoardFromSession(session);
    assert.equal(board.currentStroke, null);
    assert.equal(
      strokes.canDrawOnDrawItCanvas(session, { uid: DRAWER }).ok,
      false
    );
    assert.equal(
      strokes.canDrawOnDrawItCanvas(session, { uid: DRAWER }).reason,
      "not_drawing"
    );
    const canvas = read("js/core/drawItCanvas.js");
    const replayStart = canvas.indexOf("export function mountDrawItReplayCanvas");
    const replayEnd = canvas.indexOf("export function mountDrawItCanvas");
    assert.ok(replayStart >= 0 && replayEnd > replayStart);
    const replay = canvas.slice(replayStart, replayEnd);
    assert.doesNotMatch(replay, /addEventListener\("pointer/);
    assert.doesNotMatch(replay, /pointerdown|pointermove|pointerup|pointercancel/);
    assert.match(replay, /pointerEvents = "none"/);
    assert.match(replay, /isReadOnly\(\) \{\s*return true;/);
    assert.match(replay, /isDrawing\(\) \{\s*return false;/);
    assert.match(replay, /ResizeObserver/);
    assert.doesNotMatch(replay, /getLiveState|remoteInProgress|remoteCompleted/);
    const game = read("js/games/drawIt.js");
    assert.match(game, /mountDrawItReplayCanvas/);
    assert.match(game, /bindRecapCanvas/);
    assert.match(game, /data-readonly="true"/);
    assert.doesNotMatch(game, /phase === DRAW_IT_PHASE_REVEAL && drawer/);
    const toolsHtml = game.slice(
      game.indexOf("function toolsHtml"),
      game.indexOf("function bindTools")
    );
    assert.match(toolsHtml, /phase !== DRAW_IT_PHASE_DRAWING/);
  });

  it("C. couleur et épaisseur persistées sont rejouées", () => {
    const session = revealSession({
      strokeSeq: 2,
      strokes: [
        stroke("s1", { seq: 1, color: "#ef4444", width: 12 }),
        stroke("s2", { seq: 2, color: "#38bdf8", width: 7 }),
      ],
    });
    const board = strokes.createDrawItRecapBoardFromSession(session);
    assert.equal(board.strokes[0].color, "#ef4444");
    assert.equal(board.strokes[0].width, 12);
    assert.equal(board.strokes[1].color, "#38bdf8");
    assert.equal(board.strokes[1].width, 7);
    const ctx = recordingCtx();
    paintDrawItBoard(ctx, board, { width: 100, height: 100, dpr: 1 });
    assert.ok(ctx.ops.some((op) => Array.isArray(op) && op[0] === "style" && op[1] === "#ef4444"));
    assert.ok(ctx.ops.some((op) => Array.isArray(op) && op[0] === "width" && op[1] === 12));
    assert.ok(ctx.ops.some((op) => Array.isArray(op) && op[0] === "style" && op[1] === "#38bdf8"));
    assert.ok(ctx.ops.some((op) => Array.isArray(op) && op[0] === "width" && op[1] === 7));
  });

  it("D. ordre s1 puis s2 puis s3", () => {
    const session = revealSession({
      strokeSeq: 3,
      strokes: [
        stroke("s3", { seq: 3, points: [[0.9, 0.9], [1, 1]] }),
        stroke("s1", { seq: 1, points: [[0, 0], [0.1, 0.1]] }),
        stroke("s2", { seq: 2, points: [[0.4, 0.4], [0.5, 0.5]] }),
      ],
    });
    const board = strokes.createDrawItRecapBoardFromSession(session);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s2", "s3"]
    );
    const ctx = recordingCtx();
    paintDrawItBoard(ctx, board, { width: 10, height: 10, dpr: 1 });
    const moves = ctx.ops.filter((op) => Array.isArray(op) && op[0] === "moveTo");
    assert.deepEqual(moves, [
      ["moveTo", 0, 0],
      ["moveTo", 4, 4],
      ["moveTo", 9, 9],
    ]);
  });

  it("E. Undo : seul l'état durable final est rendu", () => {
    const drawing = drawingSession({
      strokeSeq: 3,
      strokes: [stroke("s1", { seq: 1 }), stroke("s2", { seq: 2 }), stroke("s3", { seq: 3 })],
    });
    const undone = strokes.applyDrawItDurableUndo(drawing, "s3", { uid: DRAWER });
    assert.equal(undone.ok, true);
    const recap = strokes.createDrawItRecapBoardFromSession({
      ...undone.session,
      phase: DRAW_IT_PHASE_REVEAL,
    });
    assert.deepEqual(
      recap.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    assert.equal(
      recap.strokes.some((entry) => entry.strokeId === "s3"),
      false
    );
  });

  it("F. Clear : seuls les strokes du nouvel epoch sont rendus", () => {
    const drawing = drawingSession({
      strokeSeq: 4,
      canvasEpoch: 0,
      strokes: [
        stroke("s1", { seq: 1 }),
        stroke("s2", { seq: 2 }),
        stroke("s3", { seq: 3 }),
        stroke("s4", { seq: 4 }),
      ],
    });
    const cleared = strokes.applyDrawItDurableClear(drawing, { uid: DRAWER });
    assert.equal(cleared.session.canvasEpoch, 1);
    const leaked = {
      ...cleared.session,
      phase: DRAW_IT_PHASE_REVEAL,
      strokeSeq: 2,
      strokes: [
        stroke("s1", { seq: 1, canvasEpoch: 0 }),
        stroke("s5", { seq: 1, canvasEpoch: 1, points: [[0.2, 0.8], [0.3, 0.9]] }),
        stroke("s6", { seq: 2, canvasEpoch: 1, points: [[0.7, 0.2], [0.8, 0.3]] }),
      ],
    };
    const recap = strokes.createDrawItRecapBoardFromSession(leaked);
    assert.equal(recap.canvasEpoch, 1);
    assert.deepEqual(
      recap.strokes.map((entry) => entry.strokeId),
      ["s5", "s6"]
    );
  });

  it("G. isolation de manche : round 0 ne pollue pas round 1", () => {
    const round0 = revealSession({
      roundIdx: 0,
      strokeSeq: 2,
      strokes: [stroke("s1", { seq: 1 }), stroke("s2", { seq: 2 })],
    });
    const recap0 = strokes.createDrawItRecapBoardFromSession(round0);
    assert.deepEqual(
      recap0.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const advanced = applyDrawItNextRound(round0, { nowMs: Date.now() });
    assert.equal(advanced.ok, true);
    assert.deepEqual(advanced.session.strokes, []);
    const drawing1 = strokes.createDrawItBoardFromSession(advanced.session);
    assert.deepEqual(drawing1.strokes, []);
    assert.equal(drawing1.roundIdx, 1);
    const recap1 = strokes.createDrawItRecapBoardFromSession({
      ...advanced.session,
      phase: DRAW_IT_PHASE_REVEAL,
    });
    assert.deepEqual(recap1.strokes, []);
    assert.equal(recap1.roundIdx, 1);
    const reset = strokes.maybeResetDrawItBoard(recap0, advanced.session);
    assert.deepEqual(reset.strokes, []);
    assert.equal(reset.roundIdx, 1);
  });

  it("H. early reveal : tous trouvés → recap → dessin visible", () => {
    const session = revealSession({
      strokeSeq: 2,
      strokes: [stroke("s1", { seq: 1 }), stroke("s2", { seq: 2 })],
      foundOrder: [{ uid: GUEST, at: "2026-08-15T21:00:20.000Z" }],
      lastRound: {
        roundIdx: 0,
        drawerUid: DRAWER,
        wordLabel: "chat",
        foundOrder: [{ uid: GUEST, at: "2026-08-15T21:00:20.000Z" }],
        deltas: {},
      },
      participants: [
        { userId: DRAWER, name: "Alice" },
        { userId: GUEST, name: "Bob" },
      ],
    });
    const recapMeta = buildDrawItRoundRecap(session);
    assert.equal(recapMeta.allGuessersFound, true);
    const board = strokes.createDrawItRecapBoardFromSession(session);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
  });

  it("I. timer reveal : fin timer → recap → dessin visible", () => {
    const session = revealSession({
      strokeSeq: 1,
      strokes: [stroke("s1", { seq: 1, color: "#4ade80", width: 7 })],
      foundOrder: [],
      lastRound: {
        roundIdx: 0,
        drawerUid: DRAWER,
        wordLabel: "chat",
        foundOrder: [],
        deltas: {},
      },
      participants: [
        { userId: DRAWER, name: "Alice" },
        { userId: GUEST, name: "Bob" },
      ],
    });
    const recapMeta = buildDrawItRoundRecap(session);
    assert.equal(recapMeta.allGuessersFound, false);
    const board = strokes.createDrawItRecapBoardFromSession(session);
    assert.equal(board.strokes.length, 1);
    assert.equal(board.strokes[0].strokeId, "s1");
  });

  it("J. late hydration : recap monté avant le snapshot strokes → board actualisé", () => {
    const empty = revealSession({ strokes: [], strokeSeq: 0 });
    const mounted = strokes.createDrawItRecapBoardFromSession(empty);
    assert.deepEqual(mounted.strokes, []);
    const identity = {
      runId: empty.runId,
      roundIdx: empty.roundIdx,
      phase: empty.phase,
    };
    const hydrated = revealSession({
      strokeSeq: 2,
      strokes: [stroke("s1", { seq: 1 }), stroke("s2", { seq: 2 })],
    });
    assert.equal(canKeepDrawItRecapCanvas(identity, hydrated), true);
    const updated = strokes.createDrawItRecapBoardFromSession(hydrated);
    assert.deepEqual(
      updated.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const game = read("js/games/drawIt.js");
    assert.match(game, /canKeepDrawItRecapCanvas/);
    assert.match(game, /patchRecapView/);
    assert.match(game, /applyBoard/);
    assert.doesNotMatch(
      game.slice(game.indexOf("function bindRecapCanvas"), game.indexOf("function hasStableRecapCanvas")),
      /maybeResetDrawItBoard/
    );
  });

  it("K. remount : le dessin reste présent depuis la session", () => {
    const session = revealSession({
      strokeSeq: 2,
      strokes: [
        stroke("s1", { seq: 1, color: "#facc15", width: 4 }),
        stroke("s2", { seq: 2, color: "#111111", width: 12 }),
      ],
    });
    const first = strokes.createDrawItRecapBoardFromSession(session);
    const remount = strokes.createDrawItRecapBoardFromSession(session);
    assert.deepEqual(
      remount.strokes.map((entry) => [
        entry.strokeId,
        entry.color,
        entry.width,
        entry.points,
      ]),
      first.strokes.map((entry) => [
        entry.strokeId,
        entry.color,
        entry.width,
        entry.points,
      ])
    );
    const localOnly = {
      ...strokes.createDrawItBoardFromSession(session),
      strokes: [
        ...session.strokes,
        stroke("local-only", { seq: 99, points: [[0.01, 0.01], [0.99, 0.99]] }),
      ],
    };
    const recap = strokes.createDrawItRecapBoardFromSession(session);
    assert.equal(
      recap.strokes.some((entry) => entry.strokeId === "local-only"),
      false
    );
    assert.equal(localOnly.strokes.some((entry) => entry.strokeId === "local-only"), true);
  });

  it("L. dernière manche : dessin visible avant results/leaderboard", () => {
    const session = revealSession({
      roundIdx: 2,
      roundCount: 3,
      strokeSeq: 1,
      strokes: [stroke("s9", { seq: 1, canvasEpoch: 0 })],
      lastRound: {
        roundIdx: 2,
        drawerUid: DRAWER,
        wordLabel: "chat",
        foundOrder: [],
        deltas: {},
      },
    });
    const board = strokes.createDrawItRecapBoardFromSession(session);
    assert.equal(board.roundIdx, 2);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s9"]
    );
    const game = read("js/games/drawIt.js");
    const revealBranch = game.slice(game.indexOf("phase === DRAW_IT_PHASE_REVEAL"));
    assert.match(revealBranch, /roundRecapDrawingHtml/);
    assert.match(revealBranch, /Voir les résultats →/);
    assert.match(revealBranch, /bindRecapCanvas\(session\)/);
    assert.doesNotMatch(revealBranch, /if \(last\) return;/);
  });
});

describe("Draw it ! T9 recap — frontières", () => {
  it("ne dépend pas du board local, du Broadcast, ni d'une nouvelle RPC", () => {
    const game = read("js/games/drawIt.js");
    const recapBind = game.slice(
      game.indexOf("function bindRecapCanvas"),
      game.indexOf("function hasStableRecapCanvas")
    );
    assert.match(recapBind, /createDrawItRecapBoardFromSession/);
    assert.doesNotMatch(recapBind, /maybeResetDrawItBoard|getDrawItLiveState|currentStroke|mountDrawItCanvas\(/);
    const liveRender = game.slice(
      game.indexOf("const liveRender"),
      game.indexOf("function localUid")
    );
    assert.match(liveRender, /isReadOnly/);
    assert.match(liveRender, /DRAW_IT_PHASE_REVEAL/);
    const sql = read("supabase/feature-drawit-04-strokes.sql");
    assert.match(sql, /append_drawit_stroke/);
    assert.doesNotMatch(sql, /recap_drawit|load_drawit_recap/);
    assert.doesNotMatch(read("js/core/gameSessionRpc.js"), /rpcLoadDrawItRecap|rpcRecapDrawIt/);
    assert.doesNotMatch(game, /Dessin indisponible sur cet appareil/);
    assert.doesNotMatch(game, /Dessin disponible localement/);
  });

  it("canKeepDrawItRecapCanvas reste sur la même manche reveal", () => {
    const prev = { runId: "run-t9-recap", roundIdx: 0, phase: DRAW_IT_PHASE_REVEAL };
    assert.equal(
      canKeepDrawItRecapCanvas(prev, { ...prev, strokes: [stroke("s1")] }),
      true
    );
    assert.equal(
      canKeepDrawItRecapCanvas(prev, { ...prev, phase: "drawing" }),
      false
    );
    assert.equal(
      canKeepDrawItRecapCanvas({ ...prev, phase: "drawing" }, prev),
      false
    );
    assert.equal(
      canKeepDrawItRecapCanvas(prev, { ...prev, roundIdx: 1 }),
      false
    );
    assert.equal(
      canKeepDrawItRecapCanvas(prev, { ...prev, runId: "run-b" }),
      false
    );
  });
});
