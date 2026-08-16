/**
 * Draw it ! — extension outils : couleurs + gomme vectorielle.
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
const { applyDrawItNextRound } = await import("../js/core/drawItRound.js");

const {
  DRAW_IT_TOOL_COLORS,
  DRAW_IT_TOOL_ERASE,
  DRAW_IT_TOOL_DRAW,
  DRAW_IT_STROKE_MAX_COUNT,
  applyDrawItBoardErase,
  applyDrawItDurableClear,
  applyDrawItDurableErase,
  applyDrawItPointer,
  canPersistDrawItStroke,
  collectErasedStrokeIds,
  createDrawItBrush,
  createDrawItRecapBoardFromSession,
  createEmptyDrawItBoard,
  drawItEraserRadius,
  endDrawItStroke,
  mergeDrawItDurableSnapshot,
  maybeResetDrawItBoard,
  resolveDrawItToolColor,
  undoLastCompletedDrawItStroke,
} = strokes;

function session(extra = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-tools",
    roundIdx: 0,
    roundCount: 3,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    strokeSeq: 0,
    strokes: [],
    drawerOrder: [DRAWER, GUEST],
    participants: [
      { userId: DRAWER, name: "Emma" },
      { userId: GUEST, name: "Lucas" },
    ],
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
      [0.2, 0.1],
    ],
    ...extra,
  };
}

function lastFn(source, name) {
  const needle = `create or replace function public.${name}`;
  const idx = source.lastIndexOf(needle);
  assert.ok(idx >= 0, `${name} introuvable`);
  return source.slice(idx, idx + 8000);
}

function sqlEraseRejects(current, { uid, runId, roundIdx, canvasEpoch, gameId = "drawit" }) {
  if (gameId !== "drawit") return "DRAWIT_WRONG_GAME";
  if (!current?.lobbyStarted) return "DRAWIT_NO_SESSION";
  if (String(current.runId || "") !== String(runId || "")) return "DRAWIT_STALE_RUN";
  if (Number(current.roundIdx) !== Number(roundIdx)) return "DRAWIT_STALE_ROUND";
  if (current.phase !== "drawing") return "DRAWIT_NOT_DRAWING";
  if (String(current.drawerUid || "") !== String(uid || "")) return "DRAWIT_NOT_DRAWER";
  if (Number(current.canvasEpoch) !== Number(canvasEpoch)) return "DRAWIT_STALE_EPOCH";
  return null;
}

function payload(type, overrides = {}) {
  const common = {
    type,
    runId: "run-tools",
    roundIdx: 0,
    canvasEpoch: 0,
    drawerUid: DRAWER,
  };
  if (type === "erase") return { ...common, strokeIds: ["s1"], ...overrides };
  if (type === "undo") return { ...common, strokeId: "s1", ...overrides };
  if (type === "clear") return { ...common, ...overrides };
  return {
    ...common,
    strokeId: "s1",
    seq: 1,
    color: "#f4f4f5",
    width: 4,
    ...(type === "start" || type === "chunk" ? { points: [[0.1, 0.1]] } : {}),
    ...overrides,
  };
}

describe("Draw it ! outils — couleurs", () => {
  it("A–C. rose, gris et orange disponibles", () => {
    const values = DRAW_IT_TOOL_COLORS.map((entry) => entry.value);
    assert.ok(values.includes("#ec4899"));
    assert.ok(values.includes("#9ca3af"));
    assert.ok(values.includes("#f97316"));
    assert.equal(resolveDrawItToolColor("#ec4899"), "#ec4899");
    assert.equal(resolveDrawItToolColor("#9ca3af"), "#9ca3af");
    assert.equal(resolveDrawItToolColor("#f97316"), "#f97316");
  });

  it("D. couleurs conservées dans le stroke + palette historique", () => {
    const values = DRAW_IT_TOOL_COLORS.map((entry) => entry.value);
    assert.deepEqual(values, [
      "#f4f4f5",
      "#ef4444",
      "#f97316",
      "#facc15",
      "#4ade80",
      "#38bdf8",
      "#818cf8",
      "#ec4899",
      "#9ca3af",
    ]);
    let board = createEmptyDrawItBoard({ runId: "run-tools" });
    board = applyDrawItPointer(board, "down", [0.1, 0.1], true, {
      color: "#ec4899",
      width: 7,
    });
    board = applyDrawItPointer(board, "up", [0.2, 0.2], true);
    assert.equal(board.strokes[0].color, "#ec4899");
    assert.equal(board.strokes[0].width, 7);
    assert.notEqual(board.strokes[0].color, "#ffffff");
  });
});

describe("Draw it ! outils — gomme UI / tailles", () => {
  it("E. gomme activable", () => {
    const brush = createDrawItBrush({ tool: DRAW_IT_TOOL_ERASE, width: 7 });
    assert.equal(brush.tool, DRAW_IT_TOOL_ERASE);
    assert.equal(brush.width, 7);
    const ui = read("js/games/drawIt.js");
    assert.match(ui, /id="draw-it-erase"/);
    assert.match(ui, /Gomme/);
  });

  it("F. gomme conserve la couleur ; retour dessin sans reset", () => {
    const erase = createDrawItBrush({ tool: DRAW_IT_TOOL_ERASE, color: "#ef4444" });
    const recolored = createDrawItBrush({
      color: "#38bdf8",
      width: erase.width,
      tool: erase.tool,
    });
    assert.equal(recolored.tool, DRAW_IT_TOOL_ERASE);
    assert.equal(recolored.color, "#38bdf8");
    const draw = createDrawItBrush({
      color: recolored.color,
      width: recolored.width,
      tool: DRAW_IT_TOOL_DRAW,
    });
    assert.equal(draw.tool, DRAW_IT_TOOL_DRAW);
    assert.equal(draw.color, "#38bdf8");
    const ui = read("js/games/drawIt.js");
    assert.match(ui, /id="draw-it-erase"/);
    assert.match(ui, /DRAW_IT_TOOL_DRAW/);
  });

  it("G. gomme utilise Fin / Moyen / Épais", () => {
    assert.ok(drawItEraserRadius(4) < drawItEraserRadius(7));
    assert.ok(drawItEraserRadius(7) < drawItEraserRadius(12));
    assert.equal(createDrawItBrush({ tool: DRAW_IT_TOOL_ERASE, width: 12 }).width, 12);
  });
});

describe("Draw it ! outils — intersections", () => {
  const near = stroke("s1", { points: [[0.1, 0.1], [0.25, 0.1]] });
  const far = stroke("s2", { seq: 2, points: [[0.8, 0.8], [0.95, 0.8]] });
  const mid = stroke("s3", { seq: 3, points: [[0.12, 0.12], [0.3, 0.12]] });

  it("H. gomme supprime un stroke simple", () => {
    const ids = collectErasedStrokeIds(
      [near, far],
      [[0.15, 0.1], [0.18, 0.1]],
      drawItEraserRadius(4)
    );
    assert.deepEqual(ids, ["s1"]);
    const board = applyDrawItBoardErase(
      { ...createEmptyDrawItBoard(), strokes: [near, far] },
      ids
    );
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s2"]
    );
  });

  it("I. gomme supprime plusieurs strokes intersectés", () => {
    const ids = collectErasedStrokeIds(
      [near, mid, far],
      [[0.14, 0.1], [0.16, 0.12]],
      drawItEraserRadius(12)
    );
    assert.ok(ids.includes("s1"));
    assert.ok(ids.includes("s3"));
    assert.equal(ids.includes("s2"), false);
  });

  it("J. gomme ne supprime pas un stroke hors zone", () => {
    const ids = collectErasedStrokeIds(
      [near, far],
      [[0.82, 0.82], [0.9, 0.82]],
      drawItEraserRadius(4)
    );
    assert.deepEqual(ids, ["s2"]);
    assert.equal(ids.includes("s1"), false);
  });

  it("ne crée jamais un stroke blanc / preview", () => {
    let board = createEmptyDrawItBoard({ runId: "run-tools" });
    board.strokes = [near, far];
    board = applyDrawItPointer(board, "down", [0.15, 0.1], true, {
      tool: DRAW_IT_TOOL_ERASE,
      width: 7,
    });
    assert.equal(board.currentStroke.tool, DRAW_IT_TOOL_ERASE);
    board = endDrawItStroke(board, [0.18, 0.1]);
    assert.equal(board.currentStroke, null);
    assert.equal(
      board.strokes.some((entry) => String(entry.color || "").includes("255,255,255")),
      false
    );
    assert.equal(board.strokes.some((entry) => entry.tool === DRAW_IT_TOOL_ERASE), false);
  });
});

describe("Draw it ! outils — guards gomme", () => {
  const sql = read("supabase/feature-drawit-05-erase.sql");
  const eraseFn = lastFn(sql, "erase_drawit_strokes");

  it("K. gomme respecte runId", () => {
    assert.equal(
      sqlEraseRejects(session({ runId: "run-new" }), {
        uid: DRAWER,
        runId: "run-old",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_STALE_RUN"
    );
    assert.match(eraseFn, /DRAWIT_STALE_RUN/);
  });

  it("L. gomme respecte roundIdx", () => {
    assert.equal(
      sqlEraseRejects(session({ roundIdx: 1 }), {
        uid: DRAWER,
        runId: "run-tools",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_STALE_ROUND"
    );
  });

  it("M. gomme respecte canvasEpoch", () => {
    assert.equal(
      sqlEraseRejects(session({ canvasEpoch: 2 }), {
        uid: DRAWER,
        runId: "run-tools",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_STALE_EPOCH"
    );
  });

  it("N. non-drawer refusé", () => {
    assert.equal(canPersistDrawItStroke(session(), GUEST).reason, "not_drawer");
    assert.equal(
      applyDrawItDurableErase(session({ strokes: [stroke("s1")] }), ["s1"], {
        uid: GUEST,
      }).ok,
      false
    );
    assert.match(eraseFn, /DRAWIT_NOT_DRAWER/);
    assert.doesNotMatch(eraseFn, /p_drawer_uid/);
  });

  it("O. ancien drawer refusé", () => {
    const next = applyDrawItNextRound(
      {
        ...session({
          phase: "reveal",
          roundScored: true,
          roundIdx: 0,
          drawerUid: DRAWER,
        }),
      },
      { nowMs: Date.parse("2026-08-16T16:00:00.000Z") }
    );
    assert.equal(next.ok, true);
    assert.equal(next.session.drawerUid, GUEST);
    assert.equal(
      applyDrawItDurableErase(next.session, ["s1"], { uid: DRAWER }).reason,
      "not_drawer"
    );
  });
});

describe("Draw it ! outils — durable / live / recap", () => {
  it("P. suppression durable", () => {
    const current = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2, points: [[0.8, 0.8], [0.9, 0.8]] })],
      strokeSeq: 2,
    });
    const applied = applyDrawItDurableErase(current, ["s2"], { uid: DRAWER });
    assert.equal(applied.ok, true);
    assert.deepEqual(
      applied.session.strokes.map((entry) => entry.strokeId),
      ["s1"]
    );
    assert.ok(applied.session.suppressedStrokeIds.includes("s2"));
  });

  it("Q. suppression live", () => {
    const s = session();
    let state = live.createDrawItLiveState(s);
    state = live.applyDrawItLiveEvent(state, payload("end", { strokeId: "s2" }), s).state;
    const result = live.applyDrawItLiveEvent(
      state,
      payload("erase", { strokeIds: ["s2"] }),
      s
    );
    assert.equal(result.applied, true);
    assert.equal(result.delta.action, "erase");
    assert.deepEqual(result.delta.strokeIds, ["s2"]);
    assert.equal(result.state.remoteCompleted.s2, undefined);
    const stale = live.applyDrawItLiveEvent(
      state,
      payload("erase", { runId: "run-old", strokeIds: ["s2"] }),
      s
    );
    assert.equal(stale.applied, false);
  });

  it("R. suppression survit à la reconnexion", () => {
    const erased = session({
      strokes: [stroke("s1"), stroke("s4", { seq: 4 })],
      strokeSeq: 4,
      suppressedStrokeIds: ["s2", "s3"],
    });
    const board = maybeResetDrawItBoard(createEmptyDrawItBoard(erased), erased);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s4"]
    );
    assert.equal(board.strokes.some((entry) => entry.strokeId === "s2"), false);
  });

  it("S. suppression reflétée dans recap", () => {
    const recap = createDrawItRecapBoardFromSession(
      session({
        phase: "reveal",
        strokes: [stroke("s1"), stroke("s3", { seq: 3 })],
        strokeSeq: 3,
      })
    );
    assert.deepEqual(
      recap.strokes.map((entry) => entry.strokeId),
      ["s1", "s3"]
    );
    assert.equal(recap.currentStroke, null);
  });

  it("T. ancien snapshot ne ressuscite pas les strokes supprimés", () => {
    const local = session({
      strokes: [stroke("s1")],
      suppressedStrokeIds: ["s2"],
    });
    const remote = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
    });
    const merged = mergeDrawItDurableSnapshot(local, remote);
    assert.deepEqual(
      merged.strokes.map((entry) => entry.strokeId),
      ["s1"]
    );
  });

  it("U. Clear + gomme : ancien epoch invalide", () => {
    const filled = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
      strokeSeq: 2,
    });
    const cleared = applyDrawItDurableClear(filled, { uid: DRAWER });
    assert.equal(cleared.session.canvasEpoch, 1);
    assert.deepEqual(cleared.session.strokes, []);
    const erase = applyDrawItDurableErase(cleared.session, ["s1"], { uid: DRAWER });
    assert.equal(erase.ok, true);
    assert.equal(erase.skipped, true);
    assert.equal(
      sqlEraseRejects(cleared.session, {
        uid: DRAWER,
        runId: "run-tools",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_STALE_EPOCH"
    );
  });

  it("V. nouvelle manche reset gomme / canvas", () => {
    const advanced = applyDrawItNextRound(
      session({
        phase: "reveal",
        roundScored: true,
        strokes: [stroke("s1")],
        canvasEpoch: 2,
      }),
      { nowMs: Date.parse("2026-08-16T16:00:00.000Z") }
    );
    assert.equal(advanced.ok, true);
    assert.deepEqual(advanced.session.strokes, []);
    assert.equal(advanced.session.canvasEpoch, 0);
    assert.equal(createDrawItBrush().tool, DRAW_IT_TOOL_DRAW);
    const ui = read("js/games/drawIt.js");
    assert.match(ui, /brush = createDrawItBrush\(\)/);
  });

  it("W. retry idempotent", () => {
    const current = session({ strokes: [stroke("s1"), stroke("s2", { seq: 2 })] });
    const first = applyDrawItDurableErase(current, ["s2"], { uid: DRAWER });
    const retry = applyDrawItDurableErase(first.session, ["s2"], { uid: DRAWER });
    assert.equal(retry.ok, true);
    assert.equal(retry.skipped, true);
    assert.deepEqual(
      retry.session.strokes.map((entry) => entry.strokeId),
      ["s1"]
    );
  });

  it("X. snapshot worst-case raisonnable", () => {
    const many = Array.from({ length: DRAW_IT_STROKE_MAX_COUNT }, (_, i) =>
      stroke(`s${i + 1}`, {
        seq: i + 1,
        points: [
          [0.01 * ((i % 10) + 1), 0.01 * ((i % 10) + 1)],
          [0.02 * ((i % 10) + 1), 0.02 * ((i % 10) + 1)],
        ],
      })
    );
    const path = Array.from({ length: 80 }, (_, i) => [0.01 + i * 0.01, 0.5]);
    const ids = collectErasedStrokeIds(many, path, drawItEraserRadius(12));
    assert.ok(Array.isArray(ids));
    assert.ok(ids.length <= DRAW_IT_STROKE_MAX_COUNT);
  });
});

describe("Draw it ! outils — Undo reste T9", () => {
  it("Undo après gomme retire le dernier stroke restant, sans restaurer le gommé", () => {
    const board = applyDrawItBoardErase(
      {
        ...createEmptyDrawItBoard({ runId: "run-tools" }),
        strokes: [
          stroke("s1"),
          stroke("s2", { seq: 2, points: [[0.5, 0.5], [0.6, 0.5]] }),
          stroke("s3", { seq: 3, points: [[0.8, 0.8], [0.9, 0.8]] }),
        ],
      },
      ["s2"]
    );
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s3"]
    );
    const undone = undoLastCompletedDrawItStroke(board);
    assert.deepEqual(
      undone.strokes.map((entry) => entry.strokeId),
      ["s1"]
    );
    assert.equal(
      undone.strokes.some((entry) => entry.strokeId === "s2"),
      false
    );
  });
});

describe("Draw it ! outils — SQL / wiring", () => {
  it("RPC dédiée, FOR UPDATE, pas de replace générique", () => {
    const sql = read("supabase/feature-drawit-05-erase.sql");
    assert.match(sql, /erase_drawit_strokes/);
    assert.match(sql, /for update/i);
    assert.match(sql, /auth\.uid\(\)/);
    assert.doesNotMatch(sql, /p_strokes jsonb/);
    const rpc = read("js/core/gameSessionRpc.js");
    assert.match(rpc, /rpcEraseDrawItStrokes/);
    const sessionSrc = read("js/core/drawItSession.js");
    assert.match(sessionSrc, /commitDrawItEraseStrokes/);
    assert.match(sessionSrc, /broadcastDrawItLiveErase/);
  });
});
