/**
 * Draw it ! T11 — hardening final (acting host, autorisations, isolation).
 * Audit + régression : ne réimplémente pas T1–T10.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTING = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LOBBY_ID = "11111111-1111-1111-1111-111111111111";

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const {
  ACTING_HOST_PLAY_ALLOWED_KEYS,
  validateActingHostPlayPatch,
} = await import("../js/core/gameSessionSecurity.js");
const {
  applyDrawItDurableAppend,
  applyDrawItDurableClear,
  applyDrawItDurableUndo,
  canDrawOnDrawItCanvas,
  canPersistDrawItStroke,
  createDrawItBoardFromSession,
  createDrawItRecapBoardFromSession,
  maybeResetDrawItBoard,
  mergeDrawItDurableSnapshot,
} = await import("../js/core/drawItStrokes.js");
const live = await import("../js/core/drawItLive.js");
const {
  applyDrawItNextRound,
  applyDrawItReveal,
  buildDrawItLaunchState,
  canCommitDrawItNextRound,
  canCompleteDrawItGame,
  DRAW_IT_PHASE_DRAWING,
  DRAW_IT_PHASE_REVEAL,
  emptyDrawItPlayBuffers,
  publicDrawItHasForbiddenSecrets,
} = await import("../js/core/drawItRound.js");
const { canKeepDrawItGuessComposer } = await import("../js/core/drawItGuesses.js");
const { canKeepDrawItRecapCanvas } = await import("../js/core/drawItRoundRecap.js");
const { defaultDrawItPrepSession, getDrawItSession } = await import(
  "../js/core/drawItSession.js"
);
const {
  applyRemoteSession,
  drawItToRemote,
  getEffectiveSessionScreen,
  shouldBlockLateGamePatchAfterPostGame,
  POST_GAME_SCREENS,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const { saveStatePatch } = await import("../js/core/state.js");

const participants = [
  { userId: DRAWER, name: "Emma" },
  { userId: GUEST, name: "Lucas" },
  { userId: ACTING, name: "Julie" },
];

function sql(rel) {
  return read(rel);
}

function lastFn(source, name) {
  const needle = `create or replace function public.${name}`;
  const idx = source.lastIndexOf(needle);
  assert.ok(idx >= 0, `${name} introuvable`);
  return source.slice(idx, idx + 9000);
}

function drawingSession(extra = {}) {
  return {
    lobbyStarted: true,
    phase: DRAW_IT_PHASE_DRAWING,
    runId: "run-t11",
    roundIdx: 0,
    roundCount: 3,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    strokeSeq: 0,
    strokes: [],
    foundOrder: [],
    guesses: [],
    matchScores: {},
    roundScored: false,
    roundEndsAt: "2099-01-01T00:00:00.000Z",
    participants,
    drawerOrder: [DRAWER, GUEST, ACTING],
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

function payload(type, overrides = {}) {
  const common = {
    type,
    runId: "run-t11",
    roundIdx: 0,
    canvasEpoch: 0,
    drawerUid: DRAWER,
  };
  if (type === "clear") return { ...common, ...overrides };
  if (type === "undo") return { ...common, strokeId: "s1", ...overrides };
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

/** Miroir des gardes SQL append_drawit_stroke (auth.uid vs session, pas drawerUid client). */
function sqlAppendRejects(session, { uid, runId, roundIdx, canvasEpoch, gameId = "drawit" }) {
  if (gameId !== "drawit") return "DRAWIT_WRONG_GAME";
  if (!session?.lobbyStarted) return "DRAWIT_NO_SESSION";
  if (String(session.runId || "") !== String(runId || "")) return "DRAWIT_STALE_RUN";
  if (Number(session.roundIdx) !== Number(roundIdx)) return "DRAWIT_STALE_ROUND";
  if (session.phase !== DRAW_IT_PHASE_DRAWING) return "DRAWIT_NOT_DRAWING";
  if (String(session.drawerUid || "") !== String(uid || "")) return "DRAWIT_NOT_DRAWER";
  if (Number(session.canvasEpoch) !== Number(canvasEpoch)) return "DRAWIT_STALE_EPOCH";
  return null;
}

describe("Draw it ! T11 — A. acting host audit", () => {
  const actingSql = lastFn(sql("supabase/cleanup-filrouge-02-remove-server-legacy.sql"), "apply_acting_host_play");
  const strokesSql = sql("supabase/feature-drawit-04-strokes.sql");
  const privateSql = sql("supabase/feature-drawit-02-private-word.sql");
  const sessionSrc = sql("js/core/drawItSession.js");

  it("apply_acting_host_play n'autorise ni drawit ni strokes", () => {
    assert.doesNotMatch(actingSql, /'drawit'/);
    assert.doesNotMatch(actingSql, /'strokes'/);
    assert.doesNotMatch(actingSql, /'canvasEpoch'/);
    assert.doesNotMatch(actingSql, /'drawerUid'/);
    assert.match(actingSql, /is_lobby_host\(p_lobby_id\) or public\.is_acting_host/);
  });

  it("miroir client refuse les clés dessin Draw it", () => {
    for (const key of [
      "strokes",
      "drawerUid",
      "canvasEpoch",
      "strokeSeq",
      "foundOrder",
      "guesses",
      "roundStartAt",
      "roundEndsAt",
    ]) {
      assert.equal(ACTING_HOST_PLAY_ALLOWED_KEYS.has(key), false, key);
      assert.equal(validateActingHostPlayPatch({ [key]: 1 }).ok, false, key);
    }
    assert.equal(validateActingHostPlayPatch({ phase: "reveal", matchScores: {} }).ok, true);
  });

  it("1. drawer invité persiste sans être host (RPC drawer-only, auth.uid)", () => {
    assert.match(strokesSql, /Pas de contribute générique, pas d'acting host requis/);
    assert.match(strokesSql, /v_uid_text := v_uid::text/);
    assert.match(strokesSql, /drawerUid', ''\) is distinct from v_uid_text/);
    assert.doesNotMatch(lastFn(strokesSql, "append_drawit_stroke"), /p_drawer_uid/);
    assert.doesNotMatch(lastFn(strokesSql, "append_drawit_stroke"), /is_lobby_host/);
    assert.equal(canPersistDrawItStroke(drawingSession(), DRAWER).ok, true);
    assert.equal(canPersistDrawItStroke(drawingSession(), DRAWER).ok, true);
  });

  it("2–5. acting host non-drawer : pas de dessin / persist / undo / clear", () => {
    const session = drawingSession();
    assert.equal(canDrawOnDrawItCanvas(session, { uid: ACTING }).ok, false);
    assert.equal(canPersistDrawItStroke(session, ACTING).reason, "not_drawer");
    assert.equal(applyDrawItDurableAppend(session, stroke("s1"), { uid: ACTING }).ok, false);
    assert.equal(applyDrawItDurableUndo(session, "s1", { uid: ACTING }).ok, false);
    assert.equal(applyDrawItDurableClear(session, { uid: ACTING }).ok, false);
  });

  it("2–5. acting host drawer : dessin + persist + undo + clear (identité drawer)", () => {
    const session = drawingSession({ drawerUid: ACTING });
    assert.equal(canDrawOnDrawItCanvas(session, { uid: ACTING }).ok, true);
    const appended = applyDrawItDurableAppend(session, stroke("s1"), { uid: ACTING });
    assert.equal(appended.ok, true);
    const undone = applyDrawItDurableUndo(appended.session, "s1", { uid: ACTING });
    assert.equal(undone.ok, true);
    const cleared = applyDrawItDurableClear(appended.session, { uid: ACTING });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.session.canvasEpoch, 1);
  });

  it("6–8. reveal / next / finalize : RPCs dédiées, acting host autorisé, pas apply_acting_host_play", () => {
    for (const name of ["reveal_drawit_round", "advance_drawit_round", "finalize_drawit_scores"]) {
      const body = lastFn(privateSql, name);
      assert.match(body, /is_lobby_host\(p_lobby_id\) or public\.is_acting_host/);
    }
    assert.match(sessionSrc, /canActAsHost\(\)/);
    assert.match(sessionSrc, /rpcRevealDrawItRound/);
    assert.match(sessionSrc, /rpcAdvanceDrawItRound/);
    assert.match(sessionSrc, /rpcFinalizeDrawItScores/);
    assert.doesNotMatch(sessionSrc, /commitDrawItPlay\(\{\s*strokes/);
    assert.match(sessionSrc, /rpcAppendDrawItStroke/);
  });
});

describe("Draw it ! T11 — B–G. drawer identity + stale guards", () => {
  const strokesSql = sql("supabase/feature-drawit-04-strokes.sql");

  it("B. le serveur dérive l'identité (auth.uid), pas un drawerUid client", () => {
    const append = lastFn(strokesSql, "append_drawit_stroke");
    assert.match(append, /v_uid uuid := auth\.uid\(\)/);
    assert.doesNotMatch(append, /p_drawer_uid/);
    assert.match(append, /drawerUid', ''\) is distinct from v_uid_text/);
    const claimed = applyDrawItDurableAppend(
      drawingSession({ drawerUid: DRAWER }),
      { ...stroke("s1"), drawerUid: GUEST },
      { uid: GUEST }
    );
    assert.equal(claimed.ok, false);
    assert.equal(claimed.reason, "not_drawer");
  });

  it("C. non-drawer append rejeté", () => {
    const applied = applyDrawItDurableAppend(drawingSession(), stroke("s1"), {
      uid: GUEST,
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "not_drawer");
    assert.equal(
      sqlAppendRejects(drawingSession(), {
        uid: GUEST,
        runId: "run-t11",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_NOT_DRAWER"
    );
  });

  it("D. ancien drawer rejeté après changement de manche", () => {
    const round0 = applyDrawItDurableAppend(drawingSession(), stroke("s1"), {
      uid: DRAWER,
    }).session;
    const revealed = applyDrawItReveal(
      { ...round0, foundOrder: [{ uid: GUEST }], roundEndsAt: "2020-01-01T00:00:00.000Z" },
      { wordLabel: "chat", nowMs: Date.parse("2020-01-01T00:00:01.000Z") }
    );
    assert.equal(revealed.ok, true);
    const next = applyDrawItNextRound(revealed.session, {
      nowMs: Date.parse("2020-01-01T00:00:02.000Z"),
    });
    assert.equal(next.ok, true);
    assert.equal(next.session.drawerUid, GUEST);
    assert.equal(next.session.roundIdx, 1);
    assert.deepEqual(next.session.strokes, []);
    const staleDrawer = applyDrawItDurableAppend(next.session, stroke("s2"), {
      uid: DRAWER,
    });
    assert.equal(staleDrawer.ok, false);
    assert.equal(staleDrawer.reason, "not_drawer");
    assert.equal(
      sqlAppendRejects(next.session, {
        uid: DRAWER,
        runId: "run-t11",
        roundIdx: 1,
        canvasEpoch: 0,
      }),
      "DRAWIT_NOT_DRAWER"
    );
  });

  it("E. ancien run → append refusé", () => {
    const current = drawingSession({ runId: "run-new" });
    assert.equal(
      sqlAppendRejects(current, {
        uid: DRAWER,
        runId: "run-old",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_STALE_RUN"
    );
    assert.match(lastFn(strokesSql, "append_drawit_stroke"), /DRAWIT_STALE_RUN/);
  });

  it("F. ancien round → append refusé", () => {
    const current = drawingSession({ roundIdx: 1, drawerUid: GUEST });
    assert.equal(
      sqlAppendRejects(current, {
        uid: GUEST,
        runId: "run-t11",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_STALE_ROUND"
    );
    assert.match(lastFn(strokesSql, "append_drawit_stroke"), /DRAWIT_STALE_ROUND/);
  });

  it("G. ancien epoch → append refusé", () => {
    const cleared = applyDrawItDurableClear(drawingSession(), { uid: DRAWER });
    assert.equal(cleared.session.canvasEpoch, 1);
    assert.equal(
      applyDrawItDurableClear(cleared.session, { uid: DRAWER, canvasEpoch: 0 }).reason,
      "stale_epoch"
    );
    assert.equal(
      sqlAppendRejects(cleared.session, {
        uid: DRAWER,
        runId: "run-t11",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_STALE_EPOCH"
    );
    assert.match(lastFn(strokesSql, "append_drawit_stroke"), /DRAWIT_STALE_EPOCH/);
    assert.match(
      lastFn(strokesSql, "append_drawit_stroke"),
      /v_clean->>'canvasEpoch'\)::int, -1\) is distinct from p_canvas_epoch/
    );
  });
});

describe("Draw it ! T11 — H–I. Broadcast / snapshot stale", () => {
  it("H. ancien Broadcast (run / round / epoch) ignoré", () => {
    const session = drawingSession();
    const state = live.createDrawItLiveState(session);
    const oldRun = live.applyDrawItLiveEvent(state, payload("start", { runId: "run-old" }), session);
    assert.equal(oldRun.applied, false);
    const oldRound = live.applyDrawItLiveEvent(
      state,
      payload("start", { roundIdx: 4 }),
      session
    );
    assert.equal(oldRound.applied, false);
    const oldEpoch = live.applyDrawItLiveEvent(
      state,
      payload("chunk", { canvasEpoch: 0, strokeId: "s9" }),
      drawingSession({ canvasEpoch: 1 })
    );
    assert.equal(oldEpoch.applied, false);
  });

  it("I. ancien snapshot ne ressuscite pas un Clear", () => {
    const filled = applyDrawItDurableAppend(drawingSession(), stroke("s1"), {
      uid: DRAWER,
    }).session;
    const cleared = applyDrawItDurableClear(filled, { uid: DRAWER }).session;
    const merged = mergeDrawItDurableSnapshot(cleared, filled);
    assert.equal(merged.canvasEpoch, 1);
    assert.deepEqual(merged.strokes, []);
    const board = maybeResetDrawItBoard(
      createDrawItBoardFromSession(cleared),
      filled
    );
    assert.equal(board.canvasEpoch, 1);
    assert.equal(
      board.strokes.some((entry) => entry.strokeId === "s1"),
      false
    );
  });
});

describe("Draw it ! T11 — J–K. mot privé", () => {
  const privateSql = sql("supabase/feature-drawit-02-private-word.sql");
  const guessesSql = sql("supabase/feature-drawit-03-guesses.sql");

  it("J. le mot n'entre pas dans le blob public pendant drawing", () => {
    const remote = drawItToRemote(
      drawingSession({
        wordLabel: "secret-chat",
        acceptedAnswers: ["chat"],
        wordId: "w1",
      })
    );
    assert.equal("wordLabel" in remote, false);
    assert.equal("acceptedAnswers" in remote, false);
    assert.equal("wordId" in remote, false);
    assert.equal(publicDrawItHasForbiddenSecrets(remote), false);
    assert.match(privateSql, /drawit_private_select_drawer_current/);
    assert.match(privateSql, /drawer_uid = auth\.uid\(\)/);
    assert.match(privateSql, /phase', ''\) = 'drawing'/);
    assert.match(guessesSql, /submit_drawit_guess/);
    assert.doesNotMatch(
      lastFn(guessesSql, "submit_drawit_guess"),
      /accepted_answers.*game_sessions/
    );
  });

  it("K. reveal publie wordLabel seulement après transition prévue", () => {
    const drawing = drawingSession({
      foundOrder: [{ uid: GUEST }],
      roundEndsAt: "2020-01-01T00:00:00.000Z",
    });
    assert.equal(drawing.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(drawItToRemote(drawing).lastRound, null);
    const revealed = applyDrawItReveal(drawing, {
      wordLabel: "chat",
      nowMs: Date.parse("2020-01-01T00:00:01.000Z"),
    });
    assert.equal(revealed.ok, true);
    assert.equal(revealed.session.lastRound.wordLabel, "chat");
    const remote = drawItToRemote(revealed.session);
    assert.equal(remote.lastRound.wordLabel, "chat");
    assert.equal("acceptedAnswers" in remote, false);
    assert.match(lastFn(privateSql, "reveal_drawit_round"), /drawit_revealed_state/);
    assert.match(lastFn(privateSql, "drawit_revealed_state"), /'wordLabel'/);
  });
});

describe("Draw it ! T11 — L–M. scores / finalize idempotents", () => {
  it("L. reveal dupliqué ne double pas les points", () => {
    const drawing = drawingSession({
      foundOrder: [{ uid: GUEST }],
      roundEndsAt: "2020-01-01T00:00:00.000Z",
    });
    const first = applyDrawItReveal(drawing, {
      wordLabel: "chat",
      nowMs: Date.parse("2020-01-01T00:00:01.000Z"),
    });
    assert.equal(first.ok, true);
    const scores = { ...first.session.matchScores };
    const second = applyDrawItReveal(first.session, {
      wordLabel: "chat",
      nowMs: Date.parse("2020-01-01T00:00:02.000Z"),
    });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_reveal");
    assert.deepEqual(first.session.matchScores, scores);
    const revealedSql = lastFn(
      sql("supabase/feature-drawit-02-private-word.sql"),
      "drawit_revealed_state"
    );
    assert.match(revealedSql, /roundScored.*then\s+return v_di/s);
  });

  it("M. finalize dupliqué est sûr (scoresCommittedRunId)", () => {
    const last = drawingSession({
      phase: DRAW_IT_PHASE_REVEAL,
      roundIdx: 2,
      roundCount: 3,
      roundScored: true,
      scoresCommittedRunId: "run-t11",
      runId: "run-t11",
    });
    assert.equal(canCompleteDrawItGame(last).ok, true);
    const finalize = lastFn(
      sql("supabase/feature-drawit-02-private-word.sql"),
      "finalize_drawit_scores"
    );
    assert.match(finalize, /scoresCommittedRunId/);
    assert.match(finalize, /return v_row/);
    const sessionSrc = sql("js/core/drawItSession.js");
    assert.match(sessionSrc, /scoresCommittedRunId !== session\.runId/);
  });
});

describe("Draw it ! T11 — N–O. restart + isolation de run", () => {
  it("N. restart vide tout l'état Draw it et change de runId", () => {
    const dirty = drawingSession({
      roundIdx: 2,
      canvasEpoch: 4,
      strokeSeq: 9,
      strokes: [stroke("s1")],
      foundOrder: [{ uid: GUEST }],
      guesses: [{ uid: GUEST, value: "chat" }],
      matchScores: { Lucas: 5 },
      scoresCommittedRunId: "run-t11",
    });
    const fresh = buildDrawItLaunchState({
      session: { ...defaultDrawItPrepSession(), roundCount: 3 },
      participants,
      nowMs: Date.parse("2026-08-16T16:00:00.000Z"),
      runId: "run-t11-b",
    });
    assert.notEqual(fresh.runId, dirty.runId);
    assert.equal(fresh.roundIdx, 0);
    assert.equal(fresh.canvasEpoch, 0);
    assert.equal(fresh.strokeSeq, 0);
    assert.deepEqual(fresh.strokes, []);
    assert.deepEqual(fresh.foundOrder, []);
    assert.deepEqual(fresh.guesses, []);
    assert.deepEqual(fresh.matchScores, {});
    assert.equal(fresh.scoresCommittedRunId, null);
    assert.deepEqual(fresh.drawerOrder, [DRAWER, GUEST, ACTING]);
    const buffers = emptyDrawItPlayBuffers();
    assert.deepEqual(buffers.strokes, []);
    assert.equal(buffers.canvasEpoch, 0);
  });

  it("O. ancien run ne mute pas le nouveau (append + board + merge)", () => {
    const oldRun = applyDrawItDurableAppend(drawingSession({ runId: "run-old" }), stroke("s-old"), {
      uid: DRAWER,
    }).session;
    const newRun = drawingSession({ runId: "run-new" });
    assert.equal(
      sqlAppendRejects(newRun, {
        uid: DRAWER,
        runId: "run-old",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_STALE_RUN"
    );
    const board = maybeResetDrawItBoard(createDrawItBoardFromSession(oldRun), newRun);
    assert.equal(board.runId, "run-new");
    assert.equal(
      board.strokes.some((entry) => entry.strokeId === "s-old"),
      false
    );
    const liveOld = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(newRun),
      payload("end", { runId: "run-old", strokeId: "s-old" }),
      newRun
    );
    assert.equal(liveOld.applied, false);
  });
});

describe("Draw it ! T11 — P–Q. recap read-only", () => {
  it("P. recap est read-only (pas de currentStroke, pas de dessin)", () => {
    const session = {
      ...drawingSession({
        phase: DRAW_IT_PHASE_REVEAL,
        strokes: [stroke("s1"), stroke("s2", { seq: 2 })],
        strokeSeq: 2,
      }),
    };
    const board = createDrawItRecapBoardFromSession(session);
    assert.equal(board.currentStroke, null);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1", "s2"]
    );
    assert.equal(canDrawOnDrawItCanvas(session, { uid: DRAWER }).ok, false);
    assert.equal(canPersistDrawItStroke(session, DRAWER).reason, "not_drawing");
    const canvasSrc = sql("js/core/drawItCanvas.js");
    assert.match(canvasSrc, /mountDrawItReplayCanvas/);
    assert.match(canvasSrc, /pointerEvents = "none"/);
    assert.match(canvasSrc, /isReadOnly/);
  });

  it("Q. recap ignore le Broadcast live", () => {
    const ui = sql("js/games/drawIt.js");
    assert.match(ui, /canvasCtl\?\.isReadOnly\?\.\(\)/);
    assert.match(ui, /getDrawItSession\(\)\.phase === DRAW_IT_PHASE_REVEAL/);
    assert.match(ui, /return;/);
    const recapSession = drawingSession({
      phase: DRAW_IT_PHASE_REVEAL,
      strokes: [stroke("s1")],
    });
    const recap = createDrawItRecapBoardFromSession(recapSession);
    const afterLive = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(recapSession),
      payload("start"),
      recapSession
    );
    const still = createDrawItRecapBoardFromSession(recapSession);
    assert.deepEqual(
      still.strokes.map((entry) => entry.strokeId),
      recap.strokes.map((entry) => entry.strokeId)
    );
    assert.equal(canKeepDrawItRecapCanvas(recapSession, recapSession), true);
    assert.equal(
      canKeepDrawItRecapCanvas(recapSession, drawingSession({ runId: "run-other" })),
      false
    );
    assert.ok(afterLive);
  });
});

describe("Draw it ! T11 — R–T. results / guest follow / acting host strokes", () => {
  beforeEach(() => {
    __resetCachedGameSessionForTests();
    saveStatePatch({
      inLobby: true,
      lobby: {
        id: LOBBY_ID,
        hostId: DRAWER,
        participants: participants.map((p, i) => ({
          ...p,
          isHost: i === 0,
          isLocal: i === 0,
        })),
      },
    });
  });

  afterEach(() => {
    __resetCachedGameSessionForTests();
  });

  it("R. results ne régresse pas vers Draw it", () => {
    const ended = {
      lobby_id: LOBBY_ID,
      game_id: "menu",
      screen: "results",
      updated_at: "2026-08-16T16:20:00.000Z",
      state: {
        drawIt: {
          lobbyStarted: true,
          runId: "run-t11",
          phase: DRAW_IT_PHASE_DRAWING,
          strokes: [stroke("s1")],
        },
      },
    };
    assert.equal(POST_GAME_SCREENS.has("results"), true);
    assert.equal(getEffectiveSessionScreen(ended), "results");
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(ended, {
        drawIt: { strokes: [stroke("s2")] },
      }),
      true
    );
    assert.equal(
      sqlAppendRejects(ended.state.drawIt, {
        uid: DRAWER,
        runId: "run-t11",
        roundIdx: 0,
        canvasEpoch: 0,
        gameId: "menu",
      }),
      "DRAWIT_WRONG_GAME"
    );
  });

  it("S. l'invité suit les transitions hôte (écran déclaré)", () => {
    const drawing = {
      lobby_id: LOBBY_ID,
      game_id: "drawit",
      screen: "drawit",
      updated_at: "2026-08-16T16:00:00.000Z",
      state: { drawIt: drawingSession() },
    };
    assert.equal(getEffectiveSessionScreen(drawing), "drawit");
    applyRemoteSession(drawing);
    assert.equal(getDrawItSession().phase, DRAW_IT_PHASE_DRAWING);

    const recap = {
      ...drawing,
      updated_at: "2026-08-16T16:01:00.000Z",
      state: {
        drawIt: {
          ...drawingSession({
            phase: DRAW_IT_PHASE_REVEAL,
            roundScored: true,
            lastRound: { wordLabel: "chat" },
          }),
        },
      },
    };
    applyRemoteSession(recap);
    assert.equal(getDrawItSession().phase, DRAW_IT_PHASE_REVEAL);
    assert.equal(getEffectiveSessionScreen(recap), "drawit");

    const results = {
      lobby_id: LOBBY_ID,
      game_id: "menu",
      screen: "results",
      updated_at: "2026-08-16T16:02:00.000Z",
      state: { drawIt: { ...recap.state.drawIt, lobbyStarted: false } },
    };
    assert.equal(getEffectiveSessionScreen(results), "results");
  });

  it("T. acting host ne contourne pas l'autorisation drawer-only des strokes", () => {
    const session = drawingSession({ drawerUid: GUEST });
    assert.equal(canPersistDrawItStroke(session, ACTING).ok, false);
    assert.equal(
      applyDrawItDurableAppend(session, stroke("s1"), { uid: ACTING }).reason,
      "not_drawer"
    );
    assert.equal(
      sqlAppendRejects(session, {
        uid: ACTING,
        runId: "run-t11",
        roundIdx: 0,
        canvasEpoch: 0,
      }),
      "DRAWIT_NOT_DRAWER"
    );
    assert.equal(validateActingHostPlayPatch({ strokes: [stroke("s1")] }).ok, false);
    const actingSql = lastFn(
      sql("supabase/cleanup-filrouge-02-remove-server-legacy.sql"),
      "apply_acting_host_play"
    );
    assert.doesNotMatch(actingSql, /'strokes'/);
    const nextOnLast = canCommitDrawItNextRound(
      drawingSession({ phase: DRAW_IT_PHASE_REVEAL, roundIdx: 2, roundCount: 3 })
    );
    assert.equal(nextOnLast.ok, false);
    assert.equal(nextOnLast.reason, "last_round");
  });
});

describe("Draw it ! T11 — régression T5 composer / T9 merge", () => {
  it("Clear / foundOrder ne démonte pas le composer guess", () => {
    const prev = drawingSession({ canvasEpoch: 0, foundOrder: [] });
    assert.equal(
      canKeepDrawItGuessComposer(prev, { ...prev, canvasEpoch: 1 }),
      true
    );
    assert.equal(
      canKeepDrawItGuessComposer(prev, {
        ...prev,
        foundOrder: [{ uid: GUEST }],
      }),
      true
    );
    assert.equal(
      canKeepDrawItGuessComposer(prev, { ...prev, roundIdx: 1 }),
      false
    );
  });

  it("complete_game_session_as_actor n'inclut pas drawIt (guards écran / game_id suffisent)", () => {
    const complete = lastFn(
      sql("supabase/cleanup-filrouge-02-remove-server-legacy.sql"),
      "complete_game_session_as_actor"
    );
    assert.doesNotMatch(complete, /'drawIt'/);
    assert.match(complete, /game_id = 'menu'/);
    const client = sql("js/core/gameSync.js");
    assert.match(client, /"drawIt"/);
    assert.match(client, /deactivatePlayFlagsInSessionState/);
  });
});
