/**
 * Draw it ! — anti-résurrection d'un stroke annulé (BUG-DRAWIT-UNDO-CHAIN-01).
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const strokes = await import("../js/core/drawItStrokes.js");
const { drawItFromRemote, drawItToRemote } = await import("../js/core/gameSync.js");

const {
  applyDrawItDurableAppend,
  applyDrawItDurableClear,
  applyDrawItDurableEraseSegments,
  applyDrawItDurableUndo,
  applyDrawItDurableUndoErase,
  computeDrawItPartialErase,
  createDrawItBoardFromSession,
  createEmptyDrawItBoard,
  drawItEraserRadius,
  maybeResetDrawItBoard,
  mergeDrawItDurableSnapshot,
  peekLastUndoableDrawItEdit,
  undoneDrawStrokeIds,
  undoLastDrawItEdit,
} = strokes;

function session(extra = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-resurrect",
    roundIdx: 0,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    strokeSeq: 1,
    strokes: [],
    editLog: [],
    guesses: [],
    foundOrder: [],
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

function idsOf(list) {
  return (list || []).map((entry) => entry.strokeId);
}

function drawA(current = session()) {
  return applyDrawItDurableAppend(current, stroke("s1"), { uid: DRAWER }).session;
}

function eraseA(current) {
  const mutation = computeDrawItPartialErase(
    current.strokes,
    [[0.5, 0.5]],
    drawItEraserRadius(4),
    { operationId: "e-mid" }
  );
  return applyDrawItDurableEraseSegments(current, mutation.replacements, {
    uid: DRAWER,
    operationId: "e-mid",
  }).session;
}

function undoErase(current) {
  return applyDrawItDurableUndoErase(current, "e-mid", { uid: DRAWER }).session;
}

function undoDrawA(current) {
  return applyDrawItDurableUndo(current, "s1", { uid: DRAWER }).session;
}

function drawB(current) {
  return applyDrawItDurableAppend(current, stroke("s2", { seq: 2 }), { uid: DRAWER })
    .session;
}

function chainEraseUndoDraw() {
  return undoDrawA(undoErase(eraseA(drawA())));
}

describe("Draw it ! anti-résurrection — A–G", () => {
  it("A. draw → undo → draw => ancien stroke absent", () => {
    const undone = undoDrawA(drawA());
    const next = drawB(undone);
    assert.deepEqual(idsOf(next.strokes), ["s2"]);
    const board = maybeResetDrawItBoard(
      createDrawItBoardFromSession(undone),
      undone
    );
    const after = maybeResetDrawItBoard(board, next);
    assert.deepEqual(idsOf(after.strokes), ["s2"]);
  });

  it("B. draw → erase → undo erase → undo draw → draw => A absent", () => {
    const empty = chainEraseUndoDraw();
    assert.equal(empty.strokes.some((entry) => entry.strokeId === "s1"), false);
    const next = drawB(empty);
    assert.deepEqual(idsOf(next.strokes), ["s2"]);
  });

  it("B2. resurrection path : session encore [A] au moment du nouveau dessin", () => {
    const restored = undoErase(eraseA(drawA()));
    const boardEmpty = undoLastDrawItEdit(createDrawItBoardFromSession(restored));
    assert.equal(boardEmpty.strokes.some((entry) => entry.strokeId === "s1"), false);
    const resurrected = maybeResetDrawItBoard(boardEmpty, restored);
    assert.equal(
      resurrected.strokes.some((entry) => entry.strokeId === "s1"),
      false,
      "A ne doit pas revenir depuis le snapshot post-undo-erase"
    );
    const withB = applyDrawItDurableAppend(
      {
        ...restored,
        strokes: resurrected.strokes,
        editLog: resurrected.editLog,
        suppressedStrokeIds: resurrected.suppressedStrokeIds,
      },
      stroke("s2", { seq: 2 }),
      { uid: DRAWER }
    ).session;
    assert.deepEqual(idsOf(withB.strokes), ["s2"]);
  });

  it("C. draw → undo → remote patch → draw", () => {
    const undone = undoDrawA(drawA());
    const remote = { ...drawA(), guesses: [{ uid: "guest", value: "chat" }] };
    const merged = mergeDrawItDurableSnapshot(undone, remote);
    assert.equal(merged.strokes.some((entry) => entry.strokeId === "s1"), false);
    const next = drawB({ ...undone, ...merged });
    assert.deepEqual(idsOf(next.strokes), ["s2"]);
  });

  it("D. draw → undo → guess patch → draw", () => {
    const undone = undoDrawA(drawA());
    const withGuess = {
      ...drawA(),
      guesses: [{ uid: "guest", value: "maison", at: "2026-01-01T00:00:00.000Z" }],
    };
    const merged = mergeDrawItDurableSnapshot(undone, withGuess);
    assert.equal(idsOf(merged.strokes).includes("s1"), false);
    const next = drawB({ ...undone, strokes: merged.strokes, editLog: merged.editLog, suppressedStrokeIds: merged.suppressedStrokeIds, guesses: withGuess.guesses });
    assert.deepEqual(idsOf(next.strokes), ["s2"]);
  });

  it("E. draw → undo → foundOrder patch → draw", () => {
    const undone = undoDrawA(drawA());
    const withFound = { ...drawA(), foundOrder: [{ uid: "guest" }] };
    const merged = mergeDrawItDurableSnapshot(undone, withFound);
    assert.equal(idsOf(merged.strokes).includes("s1"), false);
    const next = drawB({ ...undone, ...merged, foundOrder: withFound.foundOrder });
    assert.deepEqual(idsOf(next.strokes), ["s2"]);
  });

  it("F. draw → undo → reconnect → draw", () => {
    const undone = undoDrawA(drawA());
    const hydrated = drawItFromRemote(drawItToRemote(undone));
    const board = createDrawItBoardFromSession(hydrated);
    assert.equal(idsOf(board.strokes).includes("s1"), false);
    const next = drawB(hydrated);
    assert.deepEqual(idsOf(next.strokes), ["s2"]);
  });

  it("G. erase chain → reconnect → draw B", () => {
    const empty = chainEraseUndoDraw();
    const hydrated = drawItFromRemote(drawItToRemote(empty));
    const board = createDrawItBoardFromSession(hydrated);
    assert.equal(idsOf(board.strokes).includes("s1"), false);
    const next = drawB(hydrated);
    assert.deepEqual(idsOf(next.strokes), ["s2"]);
  });
});

describe("Draw it ! anti-résurrection — H–M", () => {
  it("H. multi-client : observateur snapshot [A] + drawer [B]", () => {
    const empty = chainEraseUndoDraw();
    const drawer = drawB(empty);
    const observerStale = undoErase(eraseA(drawA()));
    const merged = mergeDrawItDurableSnapshot(drawer, observerStale);
    assert.deepEqual(idsOf(merged.strokes), ["s2"]);
    const observerBoard = maybeResetDrawItBoard(
      createDrawItBoardFromSession(observerStale),
      { ...observerStale, ...merged }
    );
    assert.deepEqual(idsOf(observerBoard.strokes), ["s2"]);
  });

  it("I. vieux snapshot après Undo ignoré", () => {
    const empty = chainEraseUndoDraw();
    const stale = undoErase(eraseA(drawA()));
    const merged = mergeDrawItDurableSnapshot(empty, stale);
    assert.equal(idsOf(merged.strokes).includes("s1"), false);
    assert.equal(merged.strokes.length, 0);
  });

  it("J. nouveau stroke B conservé", () => {
    const next = drawB(chainEraseUndoDraw());
    assert.equal(next.strokes.length, 1);
    assert.equal(next.strokes[0].strokeId, "s2");
  });

  it("K. suppression A ne supprime pas B", () => {
    let current = applyDrawItDurableAppend(session(), stroke("s1"), { uid: DRAWER }).session;
    current = applyDrawItDurableAppend(current, stroke("s2", { seq: 2 }), { uid: DRAWER }).session;
    current = applyDrawItDurableUndo(current, "s1", { uid: DRAWER }).session;
    assert.deepEqual(idsOf(current.strokes), ["s2"]);
  });

  it("L. Clear + ancien snapshot", () => {
    const cleared = applyDrawItDurableClear(chainEraseUndoDraw(), {
      uid: DRAWER,
      canvasEpoch: 0,
    }).session;
    const stale = drawA();
    const merged = mergeDrawItDurableSnapshot(cleared, stale);
    assert.equal(merged.canvasEpoch, 1);
    assert.deepEqual(merged.strokes, []);
  });

  it("M. nouvel epoch : aucun ancien stroke", () => {
    const cleared = applyDrawItDurableClear(undoDrawA(drawA()), {
      uid: DRAWER,
      canvasEpoch: 0,
    }).session;
    const next = applyDrawItDurableAppend(
      cleared,
      stroke("s9", { seq: 1, canvasEpoch: 1 }),
      { uid: DRAWER }
    ).session;
    assert.equal(next.canvasEpoch, 1);
    assert.deepEqual(idsOf(next.strokes), ["s9"]);
    assert.equal(idsOf(next.strokes).includes("s1"), false);
  });
});

describe("Draw it ! anti-résurrection — N–T", () => {
  it("N. Undo de gomme inchangé", () => {
    const line = stroke("s1");
    const restored = undoErase(eraseA(drawA()));
    assert.equal(restored.strokes.length, 1);
    assert.equal(restored.strokes[0].strokeId, "s1");
    assert.deepEqual(restored.strokes[0].points, line.points);
  });

  it("O. Undo de draw inchangé", () => {
    const undone = undoDrawA(drawA());
    assert.deepEqual(idsOf(undone.strokes), []);
    const retry = applyDrawItDurableUndo(undone, "s1", { uid: DRAWER });
    assert.equal(retry.skipped, true);
  });

  it("P. draw/erase/draw/undo/undo/undo chronologique", () => {
    let current = drawA();
    current = eraseA(current);
    current = applyDrawItDurableAppend(current, stroke("s2", { seq: 2 }), { uid: DRAWER }).session;
    current = applyDrawItDurableUndo(current, "s2", { uid: DRAWER }).session;
    current = undoErase(current);
    current = undoDrawA(current);
    assert.equal(idsOf(current.strokes).includes("s1"), false);
    assert.equal(idsOf(current.strokes).includes("s2"), false);
    current = applyDrawItDurableAppend(current, stroke("s3", { seq: 3 }), { uid: DRAWER }).session;
    assert.deepEqual(idsOf(current.strokes), ["s3"]);
  });

  it("Q. editLog cohérent après Undo draw", () => {
    const empty = chainEraseUndoDraw();
    const drawEntry = empty.editLog.find((entry) => entry.kind === "draw" && entry.strokeId === "s1");
    assert.equal(drawEntry?.undone, true);
    assert.deepEqual(undoneDrawStrokeIds(empty.editLog, 0), ["s1"]);
    assert.equal(peekLastUndoableDrawItEdit(empty.editLog, 0), null);
  });

  it("R. suppressedStrokeIds scoped epoch / strokeId", () => {
    const empty = chainEraseUndoDraw();
    assert.ok(empty.suppressedStrokeIds.includes("s1"));
    const board = createDrawItBoardFromSession(empty);
    assert.ok(board.suppressedStrokeIds.includes("s1"));
    const cleared = applyDrawItDurableClear(empty, { uid: DRAWER, canvasEpoch: 0 }).session;
    const nextBoard = createDrawItBoardFromSession(cleared);
    assert.equal(nextBoard.canvasEpoch, 1);
    assert.equal(nextBoard.suppressedStrokeIds.includes("s1"), false);
  });

  it("S. idempotence Undo draw", () => {
    const undone = undoDrawA(drawA());
    const retry = applyDrawItDurableUndo(undone, "s1", { uid: DRAWER });
    assert.equal(retry.ok, true);
    assert.equal(retry.skipped, true);
    assert.deepEqual(idsOf(retry.session.strokes), []);
  });

  it("T. retry merge après Undo + append B", () => {
    const empty = chainEraseUndoDraw();
    const withB = drawB(empty);
    const stale = undoErase(eraseA(drawA()));
    const retry = mergeDrawItDurableSnapshot(withB, stale);
    assert.deepEqual(idsOf(retry.strokes), ["s2"]);
    const again = mergeDrawItDurableSnapshot(retry, stale);
    assert.deepEqual(idsOf(again.strokes), ["s2"]);
  });

  it("nouveau stroke B a un id distinct de A", () => {
    const empty = chainEraseUndoDraw();
    let board = createDrawItBoardFromSession(empty);
    board = strokes.beginDrawItStroke(board, [0.2, 0.2], { color: "#f4f4f5", width: 4 });
    board = strokes.endDrawItStroke(board, [0.4, 0.4]);
    assert.equal(board.strokes.length, 1);
    assert.notEqual(board.strokes[0].strokeId, "s1");
  });
});
