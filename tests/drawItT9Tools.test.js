/**
 * Draw it ! T9 — outils couleur / épaisseur / Undo / Clear.
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
mock.module("../js/core/supabaseLobby.js", {
  namedExports: {
    whenLobbyRealtimeReady: async () => ({ ok: true }),
    onLobbyRealtimeStatus() {
      return () => {};
    },
  },
});
mock.module("../js/core/router.js", {
  namedExports: {
    onScreenChange() {},
  },
});

const strokes = await import("../js/core/drawItStrokes.js");
const live = await import("../js/core/drawItLive.js");
const { applyDrawItNextRound } = await import("../js/core/drawItRound.js");

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function session(extra = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-t9",
    roundIdx: 0,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    strokeSeq: 0,
    strokes: [],
    ...extra,
  };
}

function stroke(id, extra = {}) {
  return {
    strokeId: id,
    seq: Number(String(id).replace(/\D/g, "")) || 1,
    canvasEpoch: extra.canvasEpoch ?? 0,
    color: extra.color || "#f4f4f5",
    width: extra.width ?? 4,
    points: extra.points || [
      [0.1, 0.1],
      [0.2, 0.2],
    ],
  };
}

function payload(type, extra = {}) {
  const base = {
    type,
    runId: "run-t9",
    roundIdx: 0,
    canvasEpoch: extra.canvasEpoch ?? 0,
    drawerUid: DRAWER,
  };
  if (type === "clear") return { ...base, ...extra, type };
  if (type === "undo") return { ...base, strokeId: extra.strokeId || "s3", ...extra };
  return {
    ...base,
    strokeId: extra.strokeId || "s1",
    seq: extra.seq || 1,
    color: extra.color || "#f4f4f5",
    width: extra.width ?? 4,
    ...(type === "end" ? {} : { points: extra.points || [[0.2, 0.2]] }),
    ...extra,
    type,
  };
}

function boardWith(ids) {
  let board = strokes.createEmptyDrawItBoard({ runId: "run-t9" });
  for (const id of ids) {
    board = {
      ...board,
      strokeSeq: board.strokeSeq + 1,
      strokes: [...board.strokes, stroke(id, { seq: board.strokeSeq + 1 })],
    };
  }
  return board;
}

describe("Draw it ! T9 — couleur / épaisseur", () => {
  it("A. couleur par défaut et changement pour le prochain stroke seulement", () => {
    assert.equal(strokes.DRAW_IT_DEFAULT_COLOR, "#f4f4f5");
    assert.ok(strokes.DRAW_IT_TOOL_COLORS.some((entry) => entry.value === "#ef4444"));
    assert.ok(strokes.DRAW_IT_TOOL_COLORS.some((entry) => entry.value === "#818cf8"));
    assert.equal(
      strokes.DRAW_IT_TOOL_COLORS.some((entry) => entry.value === "#111111"),
      false
    );
    let board = strokes.createEmptyDrawItBoard({ runId: "run-t9" });
    board = strokes.beginDrawItStroke(board, [0.1, 0.1], { color: "#818cf8", width: 4 });
    board = strokes.endDrawItStroke(board, [0.2, 0.2]);
    board = strokes.beginDrawItStroke(board, [0.3, 0.3], { color: "#ef4444", width: 4 });
    board = strokes.endDrawItStroke(board, [0.4, 0.4]);
    assert.equal(board.strokes[0].color, "#818cf8");
    assert.equal(board.strokes[1].color, "#ef4444");
    assert.equal(strokes.resolveDrawItToolColor("#ef4444"), "#ef4444");
    assert.equal(strokes.resolveDrawItToolColor("#not-a-color"), "#f4f4f5");
  });

  it("B. width par défaut et changement pour le prochain stroke seulement", () => {
    assert.equal(strokes.DRAW_IT_DEFAULT_WIDTH, 4);
    assert.deepEqual(
      strokes.DRAW_IT_TOOL_WIDTHS.map((entry) => entry.value),
      [4, 7, 12]
    );
    let board = strokes.createEmptyDrawItBoard({ runId: "run-t9" });
    board = strokes.beginDrawItStroke(board, [0.1, 0.1], { width: 4 });
    board = strokes.endDrawItStroke(board, [0.2, 0.2]);
    board = strokes.beginDrawItStroke(board, [0.3, 0.3], { width: 12 });
    board = strokes.endDrawItStroke(board, [0.4, 0.4]);
    assert.equal(board.strokes[0].width, 4);
    assert.equal(board.strokes[1].width, 12);
    assert.equal(strokes.resolveDrawItToolWidth(12), 12);
    assert.equal(strokes.resolveDrawItToolWidth(99), 4);
  });

  it("N. changer d'outil pendant currentStroke ne corrompt pas le trait", () => {
    let board = strokes.createEmptyDrawItBoard({ runId: "run-t9" });
    const brush = strokes.createDrawItBrush({ color: "#818cf8", width: 4 });
    board = strokes.beginDrawItStroke(board, [0.1, 0.1], brush);
    const nextBrush = strokes.createDrawItBrush({ color: "#ef4444", width: 12 });
    board = strokes.extendDrawItStroke(board, [0.3, 0.3]);
    board = strokes.endDrawItStroke(board, [0.4, 0.4]);
    assert.equal(board.strokes[0].color, "#818cf8");
    assert.equal(board.strokes[0].width, 4);
    assert.notEqual(board.strokes[0].color, nextBrush.color);
    const src = read("js/games/drawIt.js");
    assert.match(src, /if \(toolsBusy\(\)\) return;/);
  });
});

describe("Draw it ! T9 — Undo", () => {
  it("C. Undo local : [s1,s2,s3] → [s1,s2]", () => {
    const undone = strokes.undoLastCompletedDrawItStroke(boardWith(["s1", "s2", "s3"]));
    assert.deepEqual(
      undone.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const duringStroke = strokes.undoLastCompletedDrawItStroke({
      ...boardWith(["s1"]),
      currentStroke: stroke("s2"),
    });
    assert.equal(duringStroke.strokes.length, 1);
    assert.equal(duringStroke.currentStroke.strokeId, "s2");
  });

  it("D. Undo distant : Broadcast retire s3", () => {
    const s = session();
    let state = live.createDrawItLiveState(s);
    state = live.applyDrawItLiveEvent(state, payload("end", { strokeId: "s3" }), s).state;
    assert.ok(state.remoteCompleted.s3);
    const result = live.applyDrawItLiveEvent(state, payload("undo", { strokeId: "s3" }), s);
    assert.equal(result.applied, true);
    assert.equal(result.delta.action, "undo");
    assert.equal(result.delta.strokeId, "s3");
    assert.equal(result.state.remoteCompleted.s3, undefined);
  });

  it("E–F. Undo durable + idempotence", () => {
    let current = session();
    current = strokes.applyDrawItDurableAppend(current, stroke("s1"), { uid: DRAWER }).session;
    current = strokes.applyDrawItDurableAppend(current, stroke("s2", { seq: 2 }), {
      uid: DRAWER,
    }).session;
    current = strokes.applyDrawItDurableAppend(current, stroke("s3", { seq: 3 }), {
      uid: DRAWER,
    }).session;
    const undone = strokes.applyDrawItDurableUndo(current, "s3", { uid: DRAWER });
    assert.deepEqual(
      undone.session.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const retry = strokes.applyDrawItDurableUndo(undone.session, "s3", { uid: DRAWER });
    assert.equal(retry.ok, true);
    assert.equal(retry.skipped, true);
    assert.equal(retry.session.strokes.length, 2);
  });

  it("O. retry Undo ne ressuscite pas le stroke", () => {
    let board = boardWith(["s1", "s2", "s3"]);
    board = strokes.undoLastCompletedDrawItStroke(board);
    const sessionStillHas = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 }), stroke("s3", { seq: 3 })],
    });
    const merged = strokes.maybeResetDrawItBoard(board, sessionStillHas);
    assert.deepEqual(
      merged.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const retry = strokes.applyDrawItDurableUndo(sessionStillHas, "s3", { uid: DRAWER });
    assert.equal(retry.ok, true);
    assert.deepEqual(
      retry.session.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
  });
});

describe("Draw it ! T9 — Clear / epoch", () => {
  it("G. Clear local vide les strokes et incrémente l'epoch", () => {
    const cleared = strokes.applyDrawItBoardClear(boardWith(["s1", "s2"]), 1);
    assert.deepEqual(cleared.strokes, []);
    assert.equal(cleared.canvasEpoch, 1);
    assert.equal(cleared.currentStroke, null);
  });

  it("H. Clear distant vide le live", () => {
    const s = session();
    let state = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("end", { strokeId: "s1" }),
      s
    ).state;
    const result = live.applyDrawItLiveEvent(
      state,
      payload("clear", { canvasEpoch: 1 }),
      s
    );
    assert.equal(result.applied, true);
    assert.equal(result.delta.action, "clear");
    assert.equal(result.delta.canvasEpoch, 1);
    assert.deepEqual(result.state.remoteCompleted, {});
    assert.equal(result.state.identity.canvasEpoch, 1);
  });

  it("I. Clear durable : strokes=[] et epoch+1", () => {
    let current = session({ strokes: [stroke("s1"), stroke("s2", { seq: 2 })] });
    const cleared = strokes.applyDrawItDurableClear(current, { uid: DRAWER, canvasEpoch: 0 });
    assert.equal(cleared.ok, true);
    assert.deepEqual(cleared.session.strokes, []);
    assert.equal(cleared.session.canvasEpoch, 1);
    assert.equal(cleared.session.strokeSeq, 0);
  });

  it("J. ancien epoch rejeté après Clear", () => {
    const s0 = session();
    let state = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s0),
      payload("clear", { canvasEpoch: 1 }),
      s0
    ).state;
    const stale = live.applyDrawItLiveEvent(
      state,
      payload("chunk", { canvasEpoch: 0, strokeId: "s9" }),
      s0
    );
    assert.equal(stale.applied, false);
    const staleUndo = live.applyDrawItLiveEvent(
      state,
      payload("undo", { canvasEpoch: 0, strokeId: "s1" }),
      s0
    );
    assert.equal(staleUndo.applied, false);
  });

  it("K. nouveau stroke accepté sur le nouvel epoch", () => {
    const s0 = session();
    let state = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s0),
      payload("clear", { canvasEpoch: 1 }),
      s0
    ).state;
    const fresh = live.applyDrawItLiveEvent(
      state,
      payload("start", { canvasEpoch: 1, strokeId: "s1", seq: 1 }),
      s0
    );
    assert.equal(fresh.applied, true);
    assert.ok(fresh.state.remoteInProgress.s1);
  });
});

describe("Draw it ! T9 — Clear remet le crayon", () => {
  it("1. erase → clear → draw : tool=draw et un nouveau stroke peut être créé", () => {
    let brush = strokes.createDrawItBrush({
      color: "#ec4899",
      width: 12,
      tool: strokes.DRAW_IT_TOOL_ERASE,
    });
    let board = boardWith(["s1"]);
    board = strokes.applyDrawItBoardClear(board, 1);
    brush = strokes.resetDrawItBrushToDraw(brush);
    assert.equal(brush.tool, strokes.DRAW_IT_TOOL_DRAW);
    board = strokes.applyDrawItPointer(board, "down", [0.1, 0.2], true, brush);
    board = strokes.applyDrawItPointer(board, "up", [0.3, 0.2], true);
    assert.equal(board.currentStroke, null);
    assert.equal(board.strokes.length, 1);
    assert.equal(board.strokes[0].tool, strokes.DRAW_IT_TOOL_DRAW);
    assert.equal(board.strokes[0].canvasEpoch, 1);
  });

  it("2. erase → clear : canvas vide, epoch bump inchangé", () => {
    const cleared = strokes.applyDrawItBoardClear(boardWith(["s1", "s2"]), 1);
    const durable = strokes.applyDrawItDurableClear(
      session({ strokes: [stroke("s1"), stroke("s2", { seq: 2 })] }),
      { uid: DRAWER, canvasEpoch: 0 }
    );
    assert.deepEqual(cleared.strokes, []);
    assert.equal(cleared.canvasEpoch, 1);
    assert.equal(durable.ok, true);
    assert.deepEqual(durable.session.strokes, []);
    assert.equal(durable.session.canvasEpoch, 1);
    assert.equal(durable.session.tool, undefined);
  });

  it("3. erase → clear : couleur conservée", () => {
    const brush = strokes.resetDrawItBrushToDraw(
      strokes.createDrawItBrush({
        color: "#ff69b4",
        width: 12,
        tool: strokes.DRAW_IT_TOOL_ERASE,
      })
    );
    assert.equal(brush.color, "#ff69b4");
    assert.notEqual(brush.color, strokes.DRAW_IT_DEFAULT_COLOR);
  });

  it("4. erase → clear : width conservée", () => {
    const brush = strokes.resetDrawItBrushToDraw(
      strokes.createDrawItBrush({
        color: "#ff69b4",
        width: 12,
        tool: strokes.DRAW_IT_TOOL_ERASE,
      })
    );
    assert.equal(brush.width, 12);
  });

  it("5. erase → clear → draw : stroke valide, live T7 et persistence T8", () => {
    let brush = strokes.resetDrawItBrushToDraw(
      strokes.createDrawItBrush({
        color: "#38bdf8",
        width: 7,
        tool: strokes.DRAW_IT_TOOL_ERASE,
      })
    );
    let board = strokes.applyDrawItBoardClear(boardWith(["s1"]), 1);
    board = strokes.applyDrawItPointer(board, "down", [0.2, 0.3], true, brush);
    board = strokes.applyDrawItPointer(board, "up", [0.4, 0.3], true);
    const painted = board.strokes[0];
    assert.equal(painted.color, "#38bdf8");
    assert.equal(painted.width, 7);
    const s1 = { ...session(), canvasEpoch: 1 };
    const liveStart = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s1),
      payload("start", {
        canvasEpoch: 1,
        strokeId: painted.strokeId,
        seq: painted.seq,
        color: painted.color,
        width: painted.width,
        points: painted.points,
      }),
      s1
    );
    assert.equal(liveStart.applied, true);
    const durable = strokes.applyDrawItDurableAppend(s1, painted, { uid: DRAWER });
    assert.equal(durable.ok, true);
    assert.equal(durable.session.strokes[0].strokeId, painted.strokeId);
    const game = read("js/games/drawIt.js");
    assert.match(game, /resetDrawItBrushToDraw/);
    assert.match(game, /commitDrawItClearCanvas/);
    assert.match(read("js/core/drawItSession.js"), /broadcastDrawItLiveClear/);
    assert.match(read("js/core/drawItSession.js"), /rpcClearDrawItCanvas/);
  });

  it("6. draw → clear : reste draw, couleur et width inchangées", () => {
    const before = strokes.createDrawItBrush({
      color: "#f97316",
      width: 7,
      tool: strokes.DRAW_IT_TOOL_DRAW,
    });
    const after = strokes.resetDrawItBrushToDraw(before);
    assert.equal(after.tool, strokes.DRAW_IT_TOOL_DRAW);
    assert.equal(after.color, "#f97316");
    assert.equal(after.width, 7);
  });

  it("7. clear → incoming session patch : le patch ne remet pas erase", () => {
    let brush = strokes.resetDrawItBrushToDraw(
      strokes.createDrawItBrush({
        color: "#12abef",
        width: 12,
        tool: strokes.DRAW_IT_TOOL_ERASE,
      })
    );
    const local = strokes.applyDrawItBoardClear(boardWith(["s1"]), 1);
    const remote = strokes.applyDrawItDurableClear(
      session({ strokes: [stroke("s1")] }),
      { uid: DRAWER, canvasEpoch: 0 }
    ).session;
    const merged = strokes.maybeResetDrawItBoard(local, remote);
    assert.deepEqual(merged.strokes, []);
    assert.equal(merged.canvasEpoch, 1);
    assert.equal(brush.tool, strokes.DRAW_IT_TOOL_DRAW);
    assert.equal(brush.color, "#12abef");
    assert.equal(remote.tool, undefined);
    assert.equal(
      JSON.stringify(remote.strokes || []).includes("erase"),
      false
    );
  });

  it("8. Clear pendant currentStroke : guard toolsBusy inchangé", () => {
    const game = read("js/games/drawIt.js");
    const clearAt = game.indexOf('if (target.id === "draw-it-clear")');
    const clearFn = game.slice(clearAt, game.indexOf('if (target.id === "draw-it-draw"'));
    assert.match(clearFn, /if \(toolsBusy\(\)\) return;/);
    assert.match(clearFn, /resetDrawItBrushToDraw/);
    assert.match(clearFn, /if \(!\(board\.strokes \|\| \[\]\)\.length\)/);
    assert.match(game, /isDrawItToolsBusy/);
    assert.match(game, /forceIdle/);
    let board = strokes.beginDrawItStroke(
      strokes.createEmptyDrawItBoard({ runId: "run-t9" }),
      [0.1, 0.1],
      { color: "#ef4444", width: 4 }
    );
    assert.ok(board.currentStroke);
    const busy = Boolean(board.currentStroke);
    assert.equal(busy, true);
  });
});

describe("Draw it ! T9 — guards / isolation / régressions", () => {
  it("L. non-drawer : Undo et Clear refusés", () => {
    const current = session({ strokes: [stroke("s1")] });
    assert.equal(
      strokes.applyDrawItDurableUndo(current, "s1", { uid: GUEST }).reason,
      "not_drawer"
    );
    assert.equal(
      strokes.applyDrawItDurableClear(current, { uid: GUEST }).reason,
      "not_drawer"
    );
    const game = read("js/games/drawIt.js");
    assert.match(game, /if \(!isLocalDrawer\(getDrawItSession\(\)\)\) return;/);
    assert.match(game, /id="draw-it-tools"/);
  });

  it("M. Undo/Clear d'une autre manche n'affectent pas la courante", () => {
    const round0 = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
      strokeSeq: 2,
      roundCount: 3,
      drawerOrder: [DRAWER, GUEST],
      phase: "reveal",
    });
    const advanced = applyDrawItNextRound(round0, { nowMs: Date.now() });
    assert.equal(advanced.ok, true);
    assert.deepEqual(advanced.session.strokes, []);
    assert.deepEqual(
      round0.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const board = strokes.maybeResetDrawItBoard(
      strokes.createDrawItBoardFromSession(round0),
      advanced.session
    );
    assert.deepEqual(board.strokes, []);
    assert.equal(board.roundIdx, 1);
  });

  it("P. régression T7 : cadence / live inchangés", () => {
    const source = read("js/core/drawItLive.js");
    assert.match(source, /DRAW_IT_LIVE_CHUNK_MS = 100/);
    assert.match(source, /drawit:\$\{intent\.lobbyId\}/);
    assert.match(source, /ALLOWED_TYPES = new Set\(\["start", "chunk", "end", "clear", "undo", "erase", "erase_segments"\]\)/);
    assert.doesNotMatch(read("js/games/drawIt.js"), /input\.focus\(/);
  });

  it("Q. régression T8 : stroke terminé persiste toujours", () => {
    const game = read("js/games/drawIt.js");
    assert.match(game, /endDrawItLiveStroke/);
    assert.match(game, /commitDrawItCompletedStroke/);
    assert.match(game, /commitDrawItUndoStroke/);
    assert.match(game, /commitDrawItClearCanvas/);
    const sessionSrc = read("js/core/drawItSession.js");
    assert.match(sessionSrc, /rpcAppendDrawItStroke/);
    assert.match(sessionSrc, /broadcastDrawItLiveUndo/);
    assert.match(sessionSrc, /broadcastDrawItLiveClear/);
    const undoAt = sessionSrc.indexOf("export async function commitDrawItUndoStroke");
    const undoFn = sessionSrc.slice(undoAt, sessionSrc.indexOf("export async function commitDrawItClearCanvas"));
    assert.ok(undoFn.indexOf("broadcastDrawItLiveUndo") < undoFn.indexOf("rpcUndoDrawItStroke"));
  });

  it("R. worst-case V1 reste sous l'enveloppe T8", () => {
    const payloadSize = JSON.stringify({
      strokes: Array.from({ length: strokes.DRAW_IT_STROKE_MAX_COUNT }, (_, i) => ({
        strokeId: `s${i}`,
        seq: i + 1,
        canvasEpoch: 0,
        color: "#ef4444",
        width: 12,
        points: Array.from({ length: strokes.DRAW_IT_DURABLE_STROKE_MAX_POINTS }, (__, j) => [
          Number((j / 80).toFixed(3)),
          0.5,
        ]),
      })),
    }).length;
    assert.ok(payloadSize < 48_000, payloadSize);
  });
});

describe("Draw it ! T9 — anti-résurrection hydrate", () => {
  it("A. append live + snapshot intermédiaire [s1] conserve s2", () => {
    const base = session({ strokes: [stroke("s1")], strokeSeq: 1 });
    let board = strokes.createDrawItBoardFromSession(base);
    board = strokes.absorbDrawItLiveCompletedStroke(board, stroke("s2", { seq: 2 }));
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    board = strokes.maybeResetDrawItBoard(board, base);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const stale = strokes.mergeDrawItDurableSnapshot(
      { ...base, strokes: [stroke("s1"), stroke("s2", { seq: 2 })], strokeSeq: 2 },
      base
    );
    assert.deepEqual(
      stale.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const finalSnap = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
      strokeSeq: 2,
    });
    board = strokes.maybeResetDrawItBoard(board, finalSnap);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
  });

  it("B. plusieurs strokes successifs ne disparaissent pas", () => {
    let board = strokes.createEmptyDrawItBoard(session());
    const ids = ["s1", "s2", "s3", "s4"];
    const committed = [];
    for (const id of ids) {
      board = strokes.absorbDrawItLiveCompletedStroke(
        board,
        stroke(id, { seq: committed.length + 1 })
      );
      committed.push(stroke(id, { seq: committed.length }));
      const partial = session({
        strokes: committed.slice(0, -1),
        strokeSeq: Math.max(0, committed.length - 1),
      });
      board = strokes.maybeResetDrawItBoard(board, partial);
      assert.deepEqual(
        board.strokes.map((entry) => entry.strokeId),
        ids.slice(0, committed.length)
      );
    }
  });

  it("C. Clear + ancien snapshot epoch 0 ne ressuscite rien", () => {
    const before = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
      strokeSeq: 2,
      canvasEpoch: 0,
    });
    let board = strokes.createDrawItBoardFromSession(before);
    board = strokes.applyDrawItBoardClear(board, 1);
    const mergedRpc = strokes.mergeDrawItDurableSnapshot(before, {
      ...before,
      canvasEpoch: 1,
      strokes: [],
      strokeSeq: 0,
    });
    assert.equal(mergedRpc.canvasEpoch, 1);
    assert.deepEqual(mergedRpc.strokes, []);
    const mergedStale = strokes.mergeDrawItDurableSnapshot(mergedRpc, before);
    assert.equal(mergedStale.canvasEpoch, 1);
    assert.deepEqual(mergedStale.strokes, []);
    board = strokes.maybeResetDrawItBoard(board, before);
    assert.equal(board.canvasEpoch, 1);
    assert.deepEqual(board.strokes, []);
    board = strokes.maybeResetDrawItBoard(board, {
      ...mergedRpc,
      strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
    });
    assert.deepEqual(board.strokes, []);
  });

  it("D. Clear + nouveau stroke = uniquement s3", () => {
    let board = strokes.createDrawItBoardFromSession(
      session({ strokes: [stroke("s1"), stroke("s2", { seq: 2 })], strokeSeq: 2 })
    );
    board = strokes.applyDrawItBoardClear(board, 1);
    board = strokes.absorbDrawItLiveCompletedStroke(
      board,
      stroke("s3", { seq: 1, canvasEpoch: 1 })
    );
    board = strokes.maybeResetDrawItBoard(
      board,
      session({
        canvasEpoch: 0,
        strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
        strokeSeq: 2,
      })
    );
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s3"]
    );
    const recap = strokes.createDrawItRecapBoardFromSession({
      ...session(),
      canvasEpoch: 1,
      strokes: [stroke("s3", { seq: 1, canvasEpoch: 1 })],
    });
    assert.deepEqual(
      recap.strokes.map((entry) => entry.strokeId),
      ["s3"]
    );
  });

  it("E. Undo + ancien snapshot ne réintroduit pas s3", () => {
    const full = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 }), stroke("s3", { seq: 3 })],
      strokeSeq: 3,
    });
    let board = strokes.undoLastCompletedDrawItStroke(
      strokes.createDrawItBoardFromSession(full)
    );
    board = strokes.maybeResetDrawItBoard(board, full);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const merged = strokes.mergeDrawItDurableSnapshot(
      { ...full, suppressedStrokeIds: ["s3"], strokes: [stroke("s1"), stroke("s2", { seq: 2 })] },
      full
    );
    assert.deepEqual(
      merged.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
  });

  it("F. violet accepté, persisté, hydraté et rejoué", () => {
    assert.equal(strokes.resolveDrawItToolColor("#818cf8"), "#818cf8");
    const violet = stroke("s1", { color: "#818cf8", width: 7 });
    const drawing = strokes.applyDrawItDurableAppend(session(), violet, { uid: DRAWER });
    assert.equal(drawing.ok, true);
    assert.equal(drawing.session.strokes[0].color, "#818cf8");
    const board = strokes.createDrawItBoardFromSession(drawing.session);
    assert.equal(board.strokes[0].color, "#818cf8");
    const recap = strokes.createDrawItRecapBoardFromSession({
      ...drawing.session,
      phase: "reveal",
    });
    assert.equal(recap.strokes[0].color, "#818cf8");
  });

  it("G. non-régression T7 : live Broadcast inchangé", () => {
    const source = read("js/core/drawItLive.js");
    assert.match(source, /DRAW_IT_LIVE_CHUNK_MS = 100/);
    assert.match(source, /broadcast: \{ self: false/);
    assert.match(source, /ALLOWED_TYPES = new Set\(\["start", "chunk", "end", "clear", "undo", "erase", "erase_segments"\]\)/);
    const s = session();
    let state = live.createDrawItLiveState(s);
    state = live.applyDrawItLiveEvent(
      state,
      payload("start", { strokeId: "s2", seq: 1, points: [[0.2, 0.2]] }),
      s
    ).state;
    state = live.applyDrawItLiveEvent(
      state,
      payload("end", { strokeId: "s2", seq: 2 }),
      s
    ).state;
    assert.ok(state.remoteCompleted.s2);
  });

  it("H. non-régression T8 : persist reconnect conserve le snapshot", () => {
    const sessionSrc = read("js/core/drawItSession.js");
    assert.match(sessionSrc, /rpcAppendDrawItStroke/);
    assert.match(sessionSrc, /rpcUndoDrawItStroke/);
    assert.match(sessionSrc, /rpcClearDrawItCanvas/);
    const hydrated = strokes.createDrawItBoardFromSession(
      session({
        strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
        strokeSeq: 2,
      })
    );
    const remount = strokes.createDrawItBoardFromSession({
      ...session({
        strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
        strokeSeq: 2,
      }),
    });
    assert.deepEqual(
      remount.strokes.map((entry) => entry.strokeId),
      hydrated.strokes.map((entry) => entry.strokeId)
    );
  });

  it("I. recap affiche l'état durable final après Clear / Undo", () => {
    const cleared = strokes.createDrawItRecapBoardFromSession({
      ...session(),
      canvasEpoch: 1,
      strokes: [
        stroke("s1", { canvasEpoch: 0 }),
        stroke("s4", { seq: 1, canvasEpoch: 1 }),
      ],
    });
    assert.deepEqual(
      cleared.strokes.map((entry) => entry.strokeId),
      ["s4"]
    );
    const undone = strokes.createDrawItRecapBoardFromSession({
      ...session(),
      suppressedStrokeIds: ["s3"],
      strokes: [stroke("s1"), stroke("s2", { seq: 2 }), stroke("s3", { seq: 3 })],
      strokeSeq: 3,
    });
    assert.deepEqual(
      undone.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    const liveSrc = read("js/core/drawItLive.js");
    const syncFn = liveSrc.slice(liveSrc.indexOf("export function syncActiveDrawItLiveSession"));
    assert.match(syncFn, /identityChanged/);
    const game = read("js/games/drawIt.js");
    const patch = game.slice(game.indexOf("function patchDrawingLive"));
    assert.ok(
      patch.indexOf("maybeResetDrawItBoard") < patch.indexOf("syncActiveDrawItLiveSession")
    );
  });
});
