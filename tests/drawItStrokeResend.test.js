/**
 * Audit salon/reconnexion n°1 — Draw It : trait envoyé pendant une coupure.
 * Avant : jamais renvoyé ; le dessinateur le voyait, les autres non.
 * Maintenant : gardé en attente et renvoyé (prochain trait, ou écran toutes les 2 s).
 */
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** Réponse du faux serveur au prochain envoi : "ok" | "network" | code DRAWIT_*. */
let nextAnswers = [];
const sentIds = [];

mock.module("../js/core/supabaseClient.js", {
  namedExports: { isSupabaseConfigured: () => true, supabase: {} },
});
const realAuth = await import("../js/core/supabaseAuth.js");
mock.module("../js/core/supabaseAuth.js", {
  namedExports: { ...realAuth, getSupabaseUserId: () => DRAWER },
});
mock.module("../js/core/gameSessionRpc.js", {
  namedExports: {
    async rpcAppendDrawItStroke({ stroke }) {
      const answer = nextAnswers.length ? nextAnswers.shift() : "ok";
      if (answer === "network") throw new Error("Failed to fetch");
      if (answer !== "ok") throw new Error(answer);
      sentIds.push(stroke.strokeId);
      return { state: {} };
    },
  },
});

const realSync = await import("../js/core/gameSync.js");
mock.module("../js/core/gameSync.js", {
  namedExports: {
    ...realSync,
    isGameSyncActive: () => true,
    applyRemoteSession: () => {},
    refreshGameSession: async () => null,
  },
});

const { saveStatePatch } = await import("../js/core/state.js");
const drawIt = await import("../js/core/drawItSession.js");

function seat(extra = {}) {
  saveStatePatch({
    lobby: { id: "lobby-1", participants: [] },
    drawItGame: {
      lobbyStarted: true,
      phase: "drawing",
      runId: "run-1",
      roundIdx: 0,
      canvasEpoch: 0,
      drawerUid: DRAWER,
      strokeSeq: 0,
      strokes: [],
      editLog: [],
      roundEndsAt: new Date(Date.now() + 60000).toISOString(),
      ...extra,
    },
  });
}

let seq = 0;
function stroke(id) {
  seq += 1;
  return {
    strokeId: id,
    authorUid: DRAWER,
    color: "#111111",
    width: 4,
    tool: "draw",
    seq,
    canvasEpoch: 0,
    points: [
      [0.1, 0.1],
      [0.2, 0.2],
    ],
  };
}

describe("Draw It : traits renvoyés après une coupure", () => {
  beforeEach(() => {
    nextAnswers = [];
    sentIds.length = 0;
    drawIt.__resetPendingDrawItStrokesForTests();
    seat();
  });

  it("envoi raté (réseau) : le trait reste en attente", async () => {
    nextAnswers = ["network"];
    const r = await drawIt.commitDrawItCompletedStroke(stroke("s1"));
    assert.equal(r.ok, false);
    assert.equal(drawIt.countPendingDrawItStrokes(), 1);
  });

  it("le renvoi réussit quand le réseau revient", async () => {
    nextAnswers = ["network"];
    await drawIt.commitDrawItCompletedStroke(stroke("s1"));
    const out = await drawIt.flushPendingDrawItStrokes({ isStillDrawn: () => true });
    assert.equal(out.sent, 1);
    assert.equal(drawIt.countPendingDrawItStrokes(), 0);
    assert.deepEqual(sentIds, ["s1"]);
  });

  it("le trait suivant renvoie d'abord les traits ratés (ordre du dessin gardé)", async () => {
    nextAnswers = ["network"];
    await drawIt.commitDrawItCompletedStroke(stroke("s1"));
    const r = await drawIt.commitDrawItCompletedStroke(stroke("s2"), { isStillDrawn: () => true });
    assert.equal(r.ok, true);
    assert.deepEqual(sentIds, ["s1", "s2"]);
    assert.equal(drawIt.countPendingDrawItStrokes(), 0);
  });

  it("trait annulé ou gommé entre-temps : pas renvoyé", async () => {
    nextAnswers = ["network"];
    await drawIt.commitDrawItCompletedStroke(stroke("s1"));
    await drawIt.flushPendingDrawItStrokes({ isStillDrawn: () => false });
    assert.deepEqual(sentIds, []);
    assert.equal(drawIt.countPendingDrawItStrokes(), 0);
  });

  it("manche ou toile changée : trait abandonné", async () => {
    nextAnswers = ["network"];
    await drawIt.commitDrawItCompletedStroke(stroke("s1"));
    seat({ canvasEpoch: 1 });
    await drawIt.flushPendingDrawItStrokes({ isStillDrawn: () => true });
    assert.deepEqual(sentIds, []);
    assert.equal(drawIt.countPendingDrawItStrokes(), 0);
  });

  it("refus définitif du serveur : pas gardé", async () => {
    nextAnswers = ["DRAWIT_STALE_EPOCH"];
    await drawIt.commitDrawItCompletedStroke(stroke("s1"));
    assert.equal(drawIt.countPendingDrawItStrokes(), 0);
  });

  it("écran : renvoi toutes les 2 s pour le dessinateur, trait encore affiché seulement", () => {
    const game = read("js/games/drawIt.js");
    assert.match(game, /if \(mp && countPendingDrawItStrokes\(\) > 0 && isLocalDrawer\(session\)\)/);
    assert.match(game, /if \(flushNow - lastStrokeFlushAt >= 2000\)/);
    assert.match(game, /commitDrawItCompletedStroke\(stroke, \{ isStillDrawn: isStrokeStillDrawn \}\)/);
    assert.match(game, /\(board\?\.strokes \|\| \[\]\)\.some\(\(stroke\) => stroke\?\.strokeId === strokeId\)/);
  });
});
