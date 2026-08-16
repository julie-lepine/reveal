/**
 * Draw it ! T8 — persistance durable des strokes terminés.
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

const {
  DRAW_IT_DURABLE_STROKE_MAX_POINTS,
  DRAW_IT_STROKE_MAX_COUNT,
  applyDrawItDurableAppend,
  applyDrawItDurableClear,
  applyDrawItDurableUndo,
  canPersistDrawItStroke,
  completedDrawItStrokesFromSession,
  createDrawItBoardFromSession,
  downsampleDrawItStrokePoints,
  maybeResetDrawItBoard,
  toDurableDrawItStroke,
} = await import("../js/core/drawItStrokes.js");
const live = await import("../js/core/drawItLive.js");
const { applyDrawItNextRound } = await import("../js/core/drawItRound.js");

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function session(extra = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-t8",
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
    canvasEpoch: 0,
    color: "#f4f4f5",
    width: 4,
    points: [
      [0.1, 0.1],
      [0.2, 0.2],
    ],
    ...extra,
  };
}

function worstCaseSnapshot() {
  return Array.from({ length: DRAW_IT_STROKE_MAX_COUNT }, (_, i) => ({
    strokeId: `${DRAWER}:stroke-${String(i).padStart(2, "0")}`,
    seq: i + 1,
    canvasEpoch: 0,
    color: "#f4f4f5",
    width: 4,
    points: Array.from({ length: DRAW_IT_DURABLE_STROKE_MAX_POINTS }, (__, j) => [
      Number((j / 80).toFixed(3)),
      Number(((i % 9) / 10).toFixed(3)),
    ]),
  }));
}

describe("Draw it ! T8 — autorisations", () => {
  it("A. drawer peut persister un stroke valide", () => {
    const applied = applyDrawItDurableAppend(session(), stroke("s1"), { uid: DRAWER });
    assert.equal(applied.ok, true);
    assert.equal(applied.session.strokes.length, 1);
    assert.equal(applied.session.strokes[0].strokeId, "s1");
    assert.equal(Object.hasOwn(applied.session, "currentStroke"), false);
  });

  it("B. non-drawer refusé", () => {
    assert.equal(canPersistDrawItStroke(session(), GUEST).ok, false);
    const applied = applyDrawItDurableAppend(session(), stroke("s1"), { uid: GUEST });
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "not_drawer");
    assert.deepEqual(applied.session.strokes, []);
  });

  it("C–E. mauvais run / round / epoch refusés", () => {
    assert.equal(
      applyDrawItDurableAppend(session({ phase: "reveal" }), stroke("s1"), {
        uid: DRAWER,
      }).reason,
      "not_drawing"
    );
    const staleClear = applyDrawItDurableClear(session({ canvasEpoch: 2 }), {
      uid: DRAWER,
      canvasEpoch: 0,
    });
    assert.equal(staleClear.ok, false);
    assert.equal(staleClear.reason, "stale_epoch");
    const sql = read("supabase/feature-drawit-04-strokes.sql");
    assert.match(sql, /DRAWIT_STALE_RUN/);
    assert.match(sql, /DRAWIT_STALE_ROUND/);
    assert.match(sql, /DRAWIT_STALE_EPOCH/);
    const stamped = toDurableDrawItStroke(stroke("s1", { canvasEpoch: 0 }), session({ canvasEpoch: 2 }));
    assert.equal(stamped.canvasEpoch, 2);
  });

  it("F. stroke malformé refusé", () => {
    assert.equal(
      applyDrawItDurableAppend(session(), { strokeId: "s1", points: "nope" }, { uid: DRAWER })
        .ok,
      false
    );
    assert.equal(toDurableDrawItStroke({ strokeId: "s1", points: [[2, 2]] }, session()), null);
    assert.equal(
      toDurableDrawItStroke(
        { strokeId: "s1", points: [[0.1, 0.1]], wordLabel: "secret" },
        session()
      ),
      null
    );
  });
});

describe("Draw it ! T8 — caps / append / idempotence", () => {
  it("G. >80 points : client downsample, SQL refuse le brut", () => {
    const long = stroke("s-long", {
      points: Array.from({ length: 200 }, (_, i) => [i / 200, 0.5]),
    });
    const durable = toDurableDrawItStroke(long, session());
    assert.equal(durable.points.length, DRAW_IT_DURABLE_STROKE_MAX_POINTS);
    assert.deepEqual(durable.points[0], [0, 0.5]);
    assert.equal(durable.points.at(-1)[0], 0.995);
    const refused = applyDrawItDurableAppend(session(), { ...long, downsample: false }, {
      uid: DRAWER,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "too_long");
    assert.match(read("supabase/feature-drawit-04-strokes.sql"), /DRAWIT_STROKE_TOO_LONG/);
  });

  it("H. >25 strokes refusés", () => {
    let current = session({ strokes: worstCaseSnapshot(), strokeSeq: 25 });
    const applied = applyDrawItDurableAppend(current, stroke("s26", { seq: 26 }), {
      uid: DRAWER,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "stroke_cap");
    assert.equal(applied.session.strokes.length, 25);
  });

  it("I–J. append conserve les strokes précédents", () => {
    let current = session();
    current = applyDrawItDurableAppend(current, stroke("s1"), { uid: DRAWER }).session;
    current = applyDrawItDurableAppend(current, stroke("s2", { seq: 2 }), { uid: DRAWER })
      .session;
    current = applyDrawItDurableAppend(current, stroke("s3", { seq: 3 }), { uid: DRAWER })
      .session;
    assert.deepEqual(
      current.strokes.map((entry) => entry.strokeId),
      ["s1", "s2", "s3"]
    );
    assert.equal(current.strokeSeq, 3);
  });

  it("K. idempotence : s3 deux fois = une occurrence", () => {
    let current = session();
    current = applyDrawItDurableAppend(current, stroke("s3", { seq: 3 }), { uid: DRAWER })
      .session;
    const retry = applyDrawItDurableAppend(current, stroke("s3", { seq: 3 }), { uid: DRAWER });
    assert.equal(retry.ok, true);
    assert.equal(retry.skipped, true);
    assert.equal(retry.session.strokes.length, 1);
  });
});

describe("Draw it ! T8 — hydrate / live / manche", () => {
  it("L. reconnexion : session [s1,s2] → board [s1,s2] sans currentStroke", () => {
    const hydrated = createDrawItBoardFromSession(
      session({
        strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
        strokeSeq: 2,
      })
    );
    assert.deepEqual(
      hydrated.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    assert.equal(hydrated.currentStroke, null);
  });

  it("M. Broadcast + durable : pas de doublon s3", () => {
    const before = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
      strokeSeq: 2,
    });
    const liveState = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(before),
      {
        type: "end",
        runId: before.runId,
        roundIdx: 0,
        canvasEpoch: 0,
        drawerUid: DRAWER,
        strokeId: "s3",
        seq: 3,
        color: "#fff",
        width: 4,
      },
      before
    ).state;
    assert.ok(liveState.remoteCompleted.s3);
    const next = session({
      strokes: [stroke("s1"), stroke("s2", { seq: 2 }), stroke("s3", { seq: 3 })],
      strokeSeq: 3,
    });
    const durableIds = new Set(
      completedDrawItStrokesFromSession(next).map((entry) => entry.strokeId)
    );
    assert.equal(durableIds.has("s3"), true);
    assert.equal(
      Object.keys(liveState.remoteCompleted).filter((id) => !durableIds.has(id)).length,
      0
    );
    const board = createDrawItBoardFromSession(next);
    assert.equal(board.strokes.filter((entry) => entry.strokeId === "s3").length, 1);
  });

  it("N. nouvelle manche : strokes round 0 ≠ round 1", () => {
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
    const board = maybeResetDrawItBoard(
      createDrawItBoardFromSession(round0),
      advanced.session
    );
    assert.deepEqual(board.strokes, []);
    assert.equal(board.roundIdx, 1);
  });
});

describe("Draw it ! T8 — clear / undo / taille", () => {
  it("O. clear incrémente l'epoch et refuse l'ancien", () => {
    const filled = applyDrawItDurableAppend(session(), stroke("s1"), { uid: DRAWER }).session;
    const cleared = applyDrawItDurableClear(filled, { uid: DRAWER, canvasEpoch: 0 });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.session.canvasEpoch, 1);
    assert.deepEqual(cleared.session.strokes, []);
    const stale = applyDrawItDurableClear(cleared.session, { uid: DRAWER, canvasEpoch: 0 });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale_epoch");
    const sql = read("supabase/feature-drawit-04-strokes.sql");
    assert.match(sql, /create or replace function public\.clear_drawit_canvas/);
    assert.match(sql, /'canvasEpoch', v_epoch \+ 1/);
  });

  it("P. undo retire le stroke ciblé et reste idempotent", () => {
    let current = session();
    current = applyDrawItDurableAppend(current, stroke("s1"), { uid: DRAWER }).session;
    current = applyDrawItDurableAppend(current, stroke("s2", { seq: 2 }), { uid: DRAWER })
      .session;
    const undone = applyDrawItDurableUndo(current, "s1", { uid: DRAWER });
    assert.deepEqual(
      undone.session.strokes.map((entry) => entry.strokeId),
      ["s2"]
    );
    const retry = applyDrawItDurableUndo(undone.session, "s1", { uid: DRAWER });
    assert.equal(retry.ok, true);
    assert.equal(retry.skipped, true);
    assert.equal(retry.session.strokes.length, 1);
  });

  it("Q. worst-case V1 reste sous l'enveloppe 48 Ko (RPC dédiée, pas contribute 16 Ko)", () => {
    const payload = JSON.stringify({ strokes: worstCaseSnapshot() });
    assert.ok(payload.length < 48_000, payload.length);
    assert.ok(payload.length > 8_000, payload.length);
    assert.equal(downsampleDrawItStrokePoints(worstCaseSnapshot()[0].points).length, 80);
  });
});

describe("Draw it ! T8 — SQL / client / frontières", () => {
  it("RPC drawer-only, FOR UPDATE, pas de currentStroke ni acting host requis", () => {
    const sql = read("supabase/feature-drawit-04-strokes.sql");
    for (const name of [
      "append_drawit_stroke",
      "undo_drawit_stroke",
      "clear_drawit_canvas",
    ]) {
      const start = sql.indexOf(`create or replace function public.${name}`);
      assert.ok(start >= 0, name);
      const fn = sql.slice(start, start + 8000);
      assert.match(fn, /for update/i);
      assert.match(fn, /auth\.uid\(\)/);
      assert.match(fn, /DRAWIT_NOT_DRAWER/);
      assert.match(fn, /drawerUid/);
      assert.doesNotMatch(fn, /is_lobby_host|is_acting_host|currentStroke/);
    }
    const rpc = read("js/core/gameSessionRpc.js");
    assert.match(rpc, /rpcAppendDrawItStroke/);
    assert.match(rpc, /append_drawit_stroke/);
    assert.match(rpc, /undo_drawit_stroke/);
    assert.match(rpc, /clear_drawit_canvas/);
    const sessionSrc = read("js/core/drawItSession.js");
    assert.match(sessionSrc, /rpcAppendDrawItStroke/);
    assert.doesNotMatch(sessionSrc, /commitDrawItPlay\(\{\s*strokes/);
    const game = read("js/games/drawIt.js");
    assert.match(game, /endDrawItLiveStroke/);
    assert.match(game, /commitDrawItCompletedStroke/);
    const endAt = game.indexOf("onStrokeEnd");
    const liveAt = game.indexOf("endDrawItLiveStroke", endAt);
    const persistAt = game.indexOf("commitDrawItCompletedStroke", endAt);
    assert.ok(liveAt > 0 && persistAt > liveAt);
  });

  it("hydrate ignore currentStroke et déduplique par strokeId", () => {
    const hydrated = completedDrawItStrokesFromSession({
      strokes: [
        stroke("s1"),
        stroke("s1"),
        { ...stroke("s2", { seq: 2 }), currentStroke: { points: [[0, 0]] } },
      ],
    });
    assert.equal(hydrated.filter((entry) => entry.strokeId === "s1").length, 1);
    assert.equal(
      hydrated.some((entry) => Object.hasOwn(entry, "currentStroke")),
      false
    );
  });
});
