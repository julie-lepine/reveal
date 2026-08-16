/**
 * Draw it ! — Undo d'une opération de gomme partielle (FEATURE-DRAWIT-07).
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

const strokes = await import("../js/core/drawItStrokes.js");
const live = await import("../js/core/drawItLive.js");
const { createDrawItRecapBoardFromSession } = strokes;
const { drawItToRemote, drawItFromRemote } = await import("../js/core/gameSync.js");

const {
  DRAW_IT_EDIT_ERASE,
  DRAW_IT_TOOL_DRAW,
  DRAW_IT_TOOL_ERASE,
  applyDrawItBoardClear,
  applyDrawItBoardEraseSegments,
  applyDrawItBoardUndoErase,
  applyDrawItDurableAppend,
  applyDrawItDurableClear,
  applyDrawItDurableEraseSegments,
  applyDrawItDurableUndo,
  applyDrawItDurableUndoErase,
  applyDrawItPointer,
  computeDrawItPartialErase,
  createDrawItBoardFromSession,
  createDrawItBrush,
  createEmptyDrawItBoard,
  drawItEraserRadius,
  endDrawItStroke,
  mergeDrawItDurableSnapshot,
  peekLastUndoableDrawItEdit,
  selectDrawItBrushTool,
  undoLastDrawItEdit,
} = strokes;

function session(extra = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-erase-undo",
    roundIdx: 0,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    strokeSeq: 1,
    strokes: [],
    editLog: [],
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

function eraseMiddle(targets, operationId = "e-mid") {
  const list = Array.isArray(targets) ? targets : [targets];
  return computeDrawItPartialErase(
    list,
    [[0.5, 0.5]],
    drawItEraserRadius(4),
    { operationId }
  );
}

function drawThenErase(line = stroke("s1"), operationId = "e-mid") {
  const mutation = eraseMiddle(line, operationId);
  const applied = applyDrawItDurableEraseSegments(
    session({ strokes: [line], strokeSeq: line.seq }),
    mutation.replacements,
    { uid: DRAWER, operationId }
  );
  return { line, mutation, applied };
}

function payload(type, extra = {}) {
  const base = {
    type,
    runId: "run-erase-undo",
    roundIdx: 0,
    canvasEpoch: extra.canvasEpoch ?? 0,
    drawerUid: DRAWER,
  };
  if (type === "erase_undo") {
    return {
      ...base,
      operationId: extra.operationId || "e-mid",
      restoredStrokes: extra.restoredStrokes || [stroke("s1")],
      removedFragmentIds: extra.removedFragmentIds || ["s1~e-mid~0", "s1~e-mid~1"],
      ...extra,
      type,
    };
  }
  if (type === "erase_segments") {
    return {
      ...base,
      operationId: extra.operationId || "e-mid",
      replacements: extra.replacements || eraseMiddle(stroke("s1")).replacements,
      ...extra,
      type,
    };
  }
  return { ...base, ...extra, type };
}

function sqlUndoEraseRejects(
  current,
  { uid, runId, roundIdx, canvasEpoch, gameId = "drawit", op }
) {
  if (gameId !== "drawit") return "DRAWIT_WRONG_GAME";
  if (!current?.lobbyStarted) return "DRAWIT_NO_SESSION";
  if (String(current.runId || "") !== String(runId || "")) return "DRAWIT_STALE_RUN";
  if (Number(current.roundIdx) !== Number(roundIdx)) return "DRAWIT_STALE_ROUND";
  if (Number(current.canvasEpoch) !== Number(canvasEpoch)) return "DRAWIT_STALE_EPOCH";
  if (current.phase !== "drawing") return "DRAWIT_NOT_DRAWING";
  if (String(current.drawerUid || "") !== String(uid || "")) return "DRAWIT_NOT_DRAWER";
  const entry = (current.editLog || []).find(
    (item) => item?.kind === "erase" && item?.operationId === op
  );
  if (!entry) return "DRAWIT_STALE_EPOCH";
  if (entry.undone) return null;
  const last = peekLastUndoableDrawItEdit(current.editLog, current.canvasEpoch);
  if (!last || last.kind !== "erase" || last.operationId !== op) {
    return "DRAWIT_NOT_LAST_EDIT";
  }
  return null;
}

function lastFn(source, name) {
  const needle = `create or replace function public.${name}`;
  const idx = source.lastIndexOf(needle);
  assert.ok(idx >= 0, `${name} introuvable`);
  return source.slice(idx, idx + 12000);
}

describe("Draw it ! Undo gomme — A–G chronologie", () => {
  it("A. draw → erase → undo → original restored", () => {
    const { line, mutation, applied } = drawThenErase();
    assert.equal(applied.ok, true);
    assert.equal(applied.session.strokes.some((entry) => entry.strokeId === "s1"), false);
    const undone = applyDrawItDurableUndoErase(applied.session, mutation.operationId, {
      uid: DRAWER,
    });
    assert.equal(undone.ok, true);
    assert.equal(undone.session.strokes.length, 1);
    assert.equal(undone.session.strokes[0].strokeId, "s1");
    assert.deepEqual(undone.session.strokes[0].points, line.points);
  });

  it("B. erase multi-strokes → undo restaure tous", () => {
    const a = stroke("s1", { seq: 1 });
    const b = stroke("s2", { seq: 2, points: [[0.05, 0.5], [0.95, 0.5]] });
    const mutation = eraseMiddle([a, b], "e-multi");
    const erased = applyDrawItDurableEraseSegments(
      session({ strokes: [a, b], strokeSeq: 2 }),
      mutation.replacements,
      { uid: DRAWER, operationId: "e-multi" }
    ).session;
    assert.equal(erased.strokes.some((entry) => entry.strokeId === "s1"), false);
    assert.equal(erased.strokes.some((entry) => entry.strokeId === "s2"), false);
    const undone = applyDrawItDurableUndoErase(erased, "e-multi", { uid: DRAWER });
    assert.deepEqual(
      undone.session.strokes.map((entry) => entry.strokeId).sort(),
      ["s1", "s2"]
    );
  });

  it("C. draw → erase → draw → undo annule le draw", () => {
    const { applied } = drawThenErase(stroke("s1"), "e1");
    const drawn = applyDrawItDurableAppend(applied.session, stroke("s2", { seq: 2 }), {
      uid: DRAWER,
    }).session;
    const undone = applyDrawItDurableUndo(drawn, "s2", { uid: DRAWER });
    assert.deepEqual(
      undone.session.strokes.map((entry) => entry.strokeId).includes("s2"),
      false
    );
    assert.equal(undone.session.strokes.some((entry) => entry.strokeId === "s1"), false);
    const last = peekLastUndoableDrawItEdit(undone.session.editLog, 0);
    assert.equal(last.kind, DRAW_IT_EDIT_ERASE);
    assert.equal(last.operationId, "e1");
  });

  it("D. draw → erase → draw → undo → undo annule ensuite la gomme", () => {
    const line = stroke("s1");
    const { applied } = drawThenErase(line, "e1");
    const drawn = applyDrawItDurableAppend(applied.session, stroke("s2", { seq: 2 }), {
      uid: DRAWER,
    }).session;
    const afterDraw = applyDrawItDurableUndo(drawn, "s2", { uid: DRAWER }).session;
    const afterErase = applyDrawItDurableUndoErase(afterDraw, "e1", { uid: DRAWER });
    assert.equal(afterErase.session.strokes.length, 1);
    assert.equal(afterErase.session.strokes[0].strokeId, "s1");
    assert.deepEqual(afterErase.session.strokes[0].points, line.points);
  });

  it("E. erase → erase → undo → undo", () => {
    const line = stroke("s1");
    const first = eraseMiddle(line, "e1");
    let current = applyDrawItDurableEraseSegments(
      session({ strokes: [line] }),
      first.replacements,
      { uid: DRAWER, operationId: "e1" }
    ).session;
    const mid = current.strokes[0];
    const second = computeDrawItPartialErase(
      current.strokes,
      [[mid.points[0][0], mid.points[0][1]]],
      drawItEraserRadius(12),
      { operationId: "e2" }
    );
    current = applyDrawItDurableEraseSegments(current, second.replacements, {
      uid: DRAWER,
      operationId: "e2",
    }).session;
    const afterE2 = applyDrawItDurableUndoErase(current, "e2", { uid: DRAWER }).session;
    assert.ok(afterE2.strokes.length >= 1);
    assert.equal(afterE2.strokes.some((entry) => entry.strokeId === "s1"), false);
    const afterE1 = applyDrawItDurableUndoErase(afterE2, "e1", { uid: DRAWER }).session;
    assert.equal(afterE1.strokes.length, 1);
    assert.equal(afterE1.strokes[0].strokeId, "s1");
  });

  it("F–G. gomme sur fragment puis undo restaure l'état intermédiaire, pas l'original", () => {
    const line = stroke("s1");
    const first = eraseMiddle(line, "e1");
    const after1 = applyDrawItDurableEraseSegments(
      session({ strokes: [line] }),
      first.replacements,
      { uid: DRAWER, operationId: "e1" }
    ).session;
    const intermediateIds = after1.strokes.map((entry) => entry.strokeId).sort();
    const fragment = after1.strokes.find((entry) => entry.strokeId.includes("~e1~1")) || after1.strokes[1];
    const second = computeDrawItPartialErase(
      after1.strokes,
      [fragment.points[0]],
      drawItEraserRadius(12),
      { operationId: "e2" }
    );
    const after2 = applyDrawItDurableEraseSegments(after1, second.replacements, {
      uid: DRAWER,
      operationId: "e2",
    }).session;
    const undo2 = applyDrawItDurableUndoErase(after2, "e2", { uid: DRAWER }).session;
    assert.deepEqual(undo2.strokes.map((entry) => entry.strokeId).sort(), intermediateIds);
    assert.equal(undo2.strokes.some((entry) => entry.strokeId === "s1"), false);
    const undo1 = applyDrawItDurableUndoErase(undo2, "e1", { uid: DRAWER }).session;
    assert.equal(undo1.strokes.length, 1);
    assert.equal(undo1.strokes[0].strokeId, "s1");
  });
});

describe("Draw it ! Undo gomme — H–M idempotence / RPC", () => {
  it("H. erase operation idempotence", () => {
    const { mutation, applied } = drawThenErase();
    const retry = applyDrawItDurableEraseSegments(
      applied.session,
      mutation.replacements,
      { uid: DRAWER, operationId: mutation.operationId }
    );
    assert.equal(retry.ok, true);
    assert.equal(retry.skipped, true);
    assert.equal(
      retry.session.editLog.filter((entry) => entry.operationId === mutation.operationId).length,
      1
    );
  });

  it("I. undo operation idempotence", () => {
    const { mutation, applied } = drawThenErase();
    const first = applyDrawItDurableUndoErase(applied.session, mutation.operationId, {
      uid: DRAWER,
    });
    const retry = applyDrawItDurableUndoErase(first.session, mutation.operationId, {
      uid: DRAWER,
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.skipped, true);
    assert.equal(retry.session.strokes.length, 1);
  });

  it("J. RPC unauthorized non-drawer", () => {
    const { mutation, applied } = drawThenErase();
    assert.equal(
      sqlUndoEraseRejects(applied.session, {
        uid: GUEST,
        runId: "run-erase-undo",
        roundIdx: 0,
        canvasEpoch: 0,
        op: mutation.operationId,
      }),
      "DRAWIT_NOT_DRAWER"
    );
    assert.equal(
      applyDrawItDurableUndoErase(applied.session, mutation.operationId, { uid: GUEST }).reason,
      "not_drawer"
    );
  });

  it("K. stale run rejected", () => {
    const { mutation, applied } = drawThenErase();
    assert.equal(
      sqlUndoEraseRejects(applied.session, {
        uid: DRAWER,
        runId: "other-run",
        roundIdx: 0,
        canvasEpoch: 0,
        op: mutation.operationId,
      }),
      "DRAWIT_STALE_RUN"
    );
    assert.equal(
      applyDrawItDurableUndoErase(applied.session, mutation.operationId, {
        uid: DRAWER,
        runId: "other-run",
      }).reason,
      "stale_run"
    );
  });

  it("L. stale round rejected", () => {
    const { mutation, applied } = drawThenErase();
    assert.equal(
      sqlUndoEraseRejects(applied.session, {
        uid: DRAWER,
        runId: "run-erase-undo",
        roundIdx: 9,
        canvasEpoch: 0,
        op: mutation.operationId,
      }),
      "DRAWIT_STALE_ROUND"
    );
    assert.equal(
      applyDrawItDurableUndoErase(applied.session, mutation.operationId, {
        uid: DRAWER,
        roundIdx: 9,
      }).reason,
      "stale_round"
    );
  });

  it("M. stale epoch rejected", () => {
    const { mutation, applied } = drawThenErase();
    assert.equal(
      sqlUndoEraseRejects(applied.session, {
        uid: DRAWER,
        runId: "run-erase-undo",
        roundIdx: 0,
        canvasEpoch: 3,
        op: mutation.operationId,
      }),
      "DRAWIT_STALE_EPOCH"
    );
    assert.equal(
      applyDrawItDurableUndoErase(applied.session, mutation.operationId, {
        uid: DRAWER,
        canvasEpoch: 3,
      }).reason,
      "stale_epoch"
    );
  });
});

describe("Draw it ! Undo gomme — N–Q Clear / reconnexion", () => {
  it("N. Clear après erase → Undo ne restaure rien", () => {
    const { applied } = drawThenErase();
    const cleared = applyDrawItDurableClear(applied.session, { uid: DRAWER, canvasEpoch: 0 });
    assert.equal(cleared.session.strokes.length, 0);
    assert.deepEqual(cleared.session.editLog, []);
    const board = createDrawItBoardFromSession(cleared.session);
    const undone = undoLastDrawItEdit(board);
    assert.equal(undone.strokes.length, 0);
    assert.equal(peekLastUndoableDrawItEdit(cleared.session.editLog, 1), null);
  });

  it("O. Clear puis draw → Undo n'atteint jamais l'ancien epoch", () => {
    const { applied } = drawThenErase();
    const cleared = applyDrawItDurableClear(applied.session, { uid: DRAWER, canvasEpoch: 0 }).session;
    const drawn = applyDrawItDurableAppend(
      { ...cleared, canvasEpoch: 1 },
      stroke("s9", { seq: 1, canvasEpoch: 1 }),
      { uid: DRAWER }
    ).session;
    const undone = applyDrawItDurableUndo(drawn, "s9", { uid: DRAWER }).session;
    assert.equal(undone.strokes.length, 0);
    assert.equal(undone.canvasEpoch, 1);
    assert.equal(undone.strokes.some((entry) => entry.strokeId === "s1"), false);
  });

  it("P. reconnect après erase → undo fonctionne", () => {
    const { line, mutation, applied } = drawThenErase();
    const remote = drawItFromRemote(drawItToRemote(applied.session));
    const board = createDrawItBoardFromSession(remote);
    const undone = undoLastDrawItEdit(board);
    assert.equal(undone.strokes.length, 1);
    assert.equal(undone.strokes[0].strokeId, "s1");
    assert.deepEqual(undone.strokes[0].points, line.points);
    const durable = applyDrawItDurableUndoErase(remote, mutation.operationId, {
      uid: DRAWER,
    });
    assert.equal(durable.ok, true);
    assert.equal(durable.session.strokes[0].strokeId, "s1");
  });

  it("Q. reconnect après erase + undo → état correct", () => {
    const { mutation, applied } = drawThenErase();
    const undone = applyDrawItDurableUndoErase(applied.session, mutation.operationId, {
      uid: DRAWER,
    }).session;
    const remote = drawItFromRemote(drawItToRemote(undone));
    const board = createDrawItBoardFromSession(remote);
    assert.equal(board.strokes.length, 1);
    assert.equal(board.strokes[0].strokeId, "s1");
    const retry = applyDrawItDurableUndoErase(remote, mutation.operationId, { uid: DRAWER });
    assert.equal(retry.skipped, true);
  });
});

describe("Draw it ! Undo gomme — R–U Broadcast / merge", () => {
  it("R. Broadcast erase_undo appliqué une seule fois", () => {
    const s = session();
    const restored = [stroke("s1")];
    let state = live.createDrawItLiveState(s);
    const first = live.applyDrawItLiveEvent(
      state,
      payload("erase_undo", { restoredStrokes: restored, removedFragmentIds: ["s1~e-mid~0"] }),
      s
    );
    assert.equal(first.applied, true);
    assert.ok(first.state.remoteCompleted.s1);
    const second = live.applyDrawItLiveEvent(
      first.state,
      payload("erase_undo", { restoredStrokes: restored, removedFragmentIds: ["s1~e-mid~0"] }),
      s
    );
    assert.equal(second.applied, true);
    assert.equal(second.reason, "duplicate");
    assert.equal(second.delta, null);
  });

  it("S. Broadcast mauvais run ignoré", () => {
    const s = session();
    const result = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("erase_undo", { runId: "other" }),
      s
    );
    assert.equal(result.applied, false);
  });

  it("T. Broadcast mauvais epoch ignoré", () => {
    const s = session();
    const result = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("erase_undo", { canvasEpoch: 4 }),
      s
    );
    assert.equal(result.applied, false);
  });

  it("U. patch Realtime ancien après erase + undo → aucun retour en arrière", () => {
    const line = stroke("s1");
    const mutation = eraseMiddle(line, "e-mid");
    const erased = applyDrawItDurableEraseSegments(
      session({ strokes: [line] }),
      mutation.replacements,
      { uid: DRAWER, operationId: "e-mid" }
    ).session;
    const undone = applyDrawItDurableUndoErase(erased, "e-mid", { uid: DRAWER }).session;
    const merged = mergeDrawItDurableSnapshot(undone, erased);
    assert.equal(merged.strokes.length, 1);
    assert.equal(merged.strokes[0].strokeId, "s1");
    assert.equal(
      merged.strokes.some((entry) => String(entry.strokeId).includes("~e-mid~")),
      false
    );
  });
});

describe("Draw it ! Undo gomme — V–Z recap / ordre", () => {
  it("V. recap après erase → état gommé", () => {
    const { applied } = drawThenErase(stroke("s1", { color: "#12abef" }), "e-recap");
    const recap = createDrawItRecapBoardFromSession({ ...applied.session, phase: "reveal" });
    assert.equal(recap.currentStroke, null);
    assert.equal(recap.strokes.some((entry) => entry.strokeId === "s1"), false);
    assert.ok(recap.strokes.length >= 1);
  });

  it("W. recap après erase + undo → état restauré", () => {
    const line = stroke("s1", { color: "#12abef", width: 7 });
    const { mutation, applied } = drawThenErase(line, "e-recap2");
    const undone = applyDrawItDurableUndoErase(applied.session, mutation.operationId, {
      uid: DRAWER,
    }).session;
    const recap = createDrawItRecapBoardFromSession({ ...undone, phase: "reveal" });
    assert.equal(recap.strokes.length, 1);
    assert.equal(recap.strokes[0].strokeId, "s1");
    assert.equal(recap.strokes[0].color, "#12abef");
    assert.equal(recap.strokes[0].width, 7);
  });

  it("X. erase multi-strokes = une seule entrée Undo", () => {
    const a = stroke("s1", { seq: 1 });
    const b = stroke("s2", { seq: 2, points: [[0.05, 0.5], [0.95, 0.5]] });
    const mutation = eraseMiddle([a, b], "e-one");
    const erased = applyDrawItDurableEraseSegments(
      session({ strokes: [a, b], strokeSeq: 2 }),
      mutation.replacements,
      { uid: DRAWER, operationId: "e-one" }
    ).session;
    const erases = erased.editLog.filter((entry) => entry.kind === DRAW_IT_EDIT_ERASE && !entry.undone);
    assert.equal(erases.length, 1);
    assert.equal(erases[0].sourceStrokes.length, 2);
  });

  it("Y. undo erase d'un fragment ne restaure pas le stroke original précédent", () => {
    const line = stroke("s1");
    const first = eraseMiddle(line, "e1");
    const after1 = applyDrawItDurableEraseSegments(
      session({ strokes: [line] }),
      first.replacements,
      { uid: DRAWER, operationId: "e1" }
    ).session;
    const fragment = after1.strokes[1] || after1.strokes[0];
    const second = computeDrawItPartialErase(
      after1.strokes,
      [fragment.points[0]],
      drawItEraserRadius(12),
      { operationId: "e2" }
    );
    const after2 = applyDrawItDurableEraseSegments(after1, second.replacements, {
      uid: DRAWER,
      operationId: "e2",
    }).session;
    const undo2 = applyDrawItDurableUndoErase(after2, "e2", { uid: DRAWER }).session;
    assert.equal(undo2.strokes.some((entry) => entry.strokeId === "s1"), false);
  });

  it("Z. ordre chronologique draw/erase/draw/erase/undo", () => {
    let current = applyDrawItDurableAppend(session(), stroke("s1"), { uid: DRAWER }).session;
    const e1 = eraseMiddle(current.strokes[0], "e1");
    current = applyDrawItDurableEraseSegments(current, e1.replacements, {
      uid: DRAWER,
      operationId: "e1",
    }).session;
    current = applyDrawItDurableAppend(current, stroke("s2", { seq: 2 }), { uid: DRAWER }).session;
    const e2 = computeDrawItPartialErase(
      current.strokes,
      [[0.5, 0.5]],
      drawItEraserRadius(4),
      { operationId: "e2" }
    );
    current = applyDrawItDurableEraseSegments(current, e2.replacements, {
      uid: DRAWER,
      operationId: "e2",
    }).session;
    assert.equal(peekLastUndoableDrawItEdit(current.editLog, 0).operationId, "e2");
    current = applyDrawItDurableUndoErase(current, "e2", { uid: DRAWER }).session;
    assert.equal(peekLastUndoableDrawItEdit(current.editLog, 0).strokeId, "s2");
    current = applyDrawItDurableUndo(current, "s2", { uid: DRAWER }).session;
    assert.equal(peekLastUndoableDrawItEdit(current.editLog, 0).operationId, "e1");
  });
});

describe("Draw it ! Undo gomme — AA–AH UI / outils", () => {
  it("AA. Undo sur canvas vide = no-op", () => {
    const board = createEmptyDrawItBoard({ runId: "run-erase-undo" });
    const next = undoLastDrawItEdit(board);
    assert.equal(next.strokes.length, 0);
    assert.equal(peekLastUndoableDrawItEdit(next.editLog, 0), null);
  });

  it("AB. Undo après Clear = no-op", () => {
    const { applied } = drawThenErase();
    const board = applyDrawItBoardClear(
      createDrawItBoardFromSession(applied.session),
      1
    );
    const next = undoLastDrawItEdit(board);
    assert.equal(next.strokes.length, 0);
    assert.equal(next.canvasEpoch, 1);
  });

  it("AC. Undo pendant currentStroke = no-op", () => {
    const { applied } = drawThenErase();
    const board = {
      ...createDrawItBoardFromSession(applied.session),
      currentStroke: stroke("live"),
    };
    const next = undoLastDrawItEdit(board);
    assert.equal(next.currentStroke.strokeId, "live");
    assert.deepEqual(
      next.strokes.map((entry) => entry.strokeId),
      board.strokes.map((entry) => entry.strokeId)
    );
  });

  it("AD–AE. toolbar reste active après succès / erreur RPC", () => {
    const ui = read("js/games/drawIt.js");
    const undoAt = ui.indexOf('if (target.id === "draw-it-undo")');
    const undoFn = ui.slice(undoAt, ui.indexOf('if (target.id === "draw-it-clear")'));
    assert.match(undoFn, /syncToolButtons\(\)/);
    assert.doesNotMatch(undoFn, /disabled = true/);
    assert.doesNotMatch(undoFn, /innerHTML/);
    assert.doesNotMatch(undoFn, /teardownChat/);
    assert.doesNotMatch(undoFn, /input\.focus\(/);
    assert.match(undoFn, /commitDrawItUndoErase/);
    assert.match(undoFn, /commitDrawItUndoStroke/);
  });

  it("AF–AG. couleur et width conservées après erase undo", () => {
    const line = stroke("s1", { color: "#38bdf8", width: 12 });
    const { mutation, applied } = drawThenErase(line, "e-style");
    const undone = applyDrawItDurableUndoErase(applied.session, mutation.operationId, {
      uid: DRAWER,
    }).session;
    assert.equal(undone.strokes[0].color, "#38bdf8");
    assert.equal(undone.strokes[0].width, 12);
  });

  it("AH. crayon/gomme restent sélectionnables après Undo", () => {
    const { mutation, applied } = drawThenErase();
    applyDrawItDurableUndoErase(applied.session, mutation.operationId, { uid: DRAWER });
    const erase = selectDrawItBrushTool(createDrawItBrush(), DRAW_IT_TOOL_ERASE);
    const draw = selectDrawItBrushTool(erase, DRAW_IT_TOOL_DRAW);
    assert.equal(erase.tool, DRAW_IT_TOOL_ERASE);
    assert.equal(draw.tool, DRAW_IT_TOOL_DRAW);
    let board = createEmptyDrawItBoard({ runId: "run-erase-undo" });
    board = applyDrawItPointer(board, "down", [0.1, 0.1], true, {
      ...createDrawItBrush({ tool: DRAW_IT_TOOL_DRAW }),
    });
    board = endDrawItStroke(board, [0.2, 0.2]);
    assert.equal(board.currentStroke, null);
    assert.equal(board.strokes.length, 1);
  });
});

describe("Draw it ! Undo gomme — SQL / câblage", () => {
  it("migration 07 autonome, RPC dédiée, FOR UPDATE, pas de snapshot p_strokes", () => {
    const sql = read("supabase/feature-drawit-07-erase-undo.sql");
    assert.match(sql, /feature-drawit-06-partial-erase/);
    assert.match(sql, /undo_drawit_erase/);
    assert.match(lastFn(sql, "undo_drawit_erase"), /for update/i);
    assert.match(lastFn(sql, "undo_drawit_erase"), /auth\.uid\(\)/);
    assert.match(lastFn(sql, "undo_drawit_erase"), /DRAWIT_NOT_DRAWER/);
    assert.match(lastFn(sql, "undo_drawit_erase"), /DRAWIT_STALE_RUN/);
    assert.match(lastFn(sql, "undo_drawit_erase"), /DRAWIT_STALE_ROUND/);
    assert.match(lastFn(sql, "undo_drawit_erase"), /DRAWIT_STALE_EPOCH/);
    assert.match(lastFn(sql, "undo_drawit_erase"), /drawerUid/);
    assert.doesNotMatch(lastFn(sql, "undo_drawit_erase"), /p_drawer_uid/);
    assert.doesNotMatch(sql, /p_strokes jsonb/);
    assert.match(sql, /notify pgrst, 'reload schema'/);
    assert.match(sql, /editLog/);
    assert.match(sql, /sourceStrokes/);
    const rpc = read("js/core/gameSessionRpc.js");
    assert.match(rpc, /rpcUndoDrawItErase/);
    assert.match(rpc, /undo_drawit_erase/);
    const sessionSrc = read("js/core/drawItSession.js");
    assert.match(sessionSrc, /commitDrawItUndoErase/);
    assert.match(sessionSrc, /broadcastDrawItLiveEraseUndo/);
    const liveSrc = read("js/core/drawItLive.js");
    assert.match(liveSrc, /erase_undo/);
  });

  it("board live erase_undo restaure les sources", () => {
    const line = stroke("s1");
    const mutation = eraseMiddle(line, "e-live");
    const erased = applyDrawItBoardEraseSegments(
      { ...createEmptyDrawItBoard(), strokes: [line] },
      mutation.replacements,
      { operationId: "e-live" }
    );
    const restored = applyDrawItBoardUndoErase(erased, {
      operationId: "e-live",
      sourceStrokes: [line],
      replacementStrokeIds: erased.strokes.map((entry) => entry.strokeId),
    });
    assert.equal(restored.strokes.length, 1);
    assert.equal(restored.strokes[0].strokeId, "s1");
  });
});
