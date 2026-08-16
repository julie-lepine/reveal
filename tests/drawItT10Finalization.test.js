/**
 * Draw it ! T10 — fin de série / results / restart / late patch.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const EMMA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LUCAS = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const JULIE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LOBBY_ID = "11111111-1111-1111-1111-111111111111";

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const {
  applyDrawItNextRound,
  applyDrawItReveal,
  buildDrawItLaunchState,
  canCommitDrawItNextRound,
  canCompleteDrawItGame,
  emptyDrawItPlayBuffers,
  isNewDrawItRound,
  isStaleDrawItRound,
  DRAW_IT_PHASE_DRAWING,
  DRAW_IT_PHASE_REVEAL,
} = await import("../js/core/drawItRound.js");
const { DRAW_IT_ROUND_DURATION_MS } = await import("../data/drawIt.js");
const { buildDrawItStandings } = await import("../js/core/drawItScoring.js");
const { createDrawItRecapBoardFromSession } = await import(
  "../js/core/drawItStrokes.js"
);
const { defaultDrawItPrepSession, getDrawItSession } = await import("../js/core/drawItSession.js");
const { createDrawItRunId } = await import("../js/core/drawItRunId.js");
const {
  applyRemoteSession,
  drawItFromRemote,
  drawItToRemote,
  getEffectiveSessionScreen,
  shouldBlockLateGamePatchAfterPostGame,
  POST_GAME_SCREENS,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const { saveStatePatch } = await import("../js/core/state.js");
const { serializeLastGameStandings } = await import("../js/core/lastGamePodium.js");

const participants = [
  { userId: EMMA, name: "Emma" },
  { userId: LUCAS, name: "Lucas" },
  { userId: JULIE, name: "Julie" },
];

function launch(extra = {}) {
  return buildDrawItLaunchState({
    session: { roundCount: 3, selectedCategoryId: "catalog", ...extra },
    participants,
    nowMs: Date.parse("2026-08-16T14:00:00.000Z"),
    runId: extra.runId || "run-t10",
  });
}

function reveal(session, foundOrder, wordLabel = "chat") {
  const scored = applyDrawItReveal(
    { ...session, foundOrder },
    {
      wordLabel,
      nowMs: Date.parse(session.roundEndsAt),
    }
  );
  assert.equal(scored.ok, true);
  return scored.session;
}

function next(session) {
  const advanced = applyDrawItNextRound(session, {
    nowMs: Date.parse(session.roundEndsAt) + 1_000,
  });
  assert.equal(advanced.ok, true);
  return advanced.session;
}

function playSeries() {
  let session = launch();
  session = reveal(session, [{ uid: LUCAS }, { uid: JULIE }]);
  const afterOne = session;
  session = next(session);
  session = reveal(session, [{ uid: EMMA }]);
  const afterTwo = session;
  session = next(session);
  session = reveal(session, [{ uid: EMMA }, { uid: LUCAS }]);
  return { afterOne, afterTwo, last: session };
}

function recapRow({
  screen = "drawit",
  gameId = "drawit",
  lobbyStarted = true,
  phase = DRAW_IT_PHASE_REVEAL,
  runId = "run-t10",
  roundIdx = 0,
  updatedAt = "2026-08-16T14:05:00.000Z",
  extra = {},
} = {}) {
  return {
    lobby_id: LOBBY_ID,
    game_id: gameId,
    screen,
    updated_at: updatedAt,
    state: {
      drawIt: {
        lobbyStarted,
        runId,
        roundIdx,
        roundCount: 3,
        phase,
        selectedCategoryId: "catalog",
        ...extra,
      },
    },
  };
}

describe("Draw it ! T10 — fin de manche / dernière manche", () => {
  it("A. manche non finale : recap puis next round", () => {
    const recap = reveal(launch(), [{ uid: LUCAS }]);
    assert.equal(recap.phase, DRAW_IT_PHASE_REVEAL);
    assert.equal(canCommitDrawItNextRound(recap).ok, true);
    assert.equal(canCompleteDrawItGame(recap).ok, false);
    const following = next(recap);
    assert.equal(following.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(following.roundIdx, 1);
    assert.deepEqual(following.strokes, []);
    assert.deepEqual(following.guesses, []);
    assert.deepEqual(following.foundOrder, []);
    assert.equal(following.canvasEpoch, 0);
    const game = read("js/games/drawIt.js");
    assert.match(game, /Manche suivante →/);
    assert.match(game, /commitDrawItNextRound/);
  });

  it("B. dernière manche : recap puis results, pas de next", () => {
    const { last } = playSeries();
    assert.equal(last.roundIdx, 2);
    assert.equal(last.phase, DRAW_IT_PHASE_REVEAL);
    assert.equal(canCommitDrawItNextRound(last).ok, false);
    assert.equal(canCommitDrawItNextRound(last).reason, "last_round");
    assert.equal(canCompleteDrawItGame(last).ok, true);
    const game = read("js/games/drawIt.js");
    assert.match(game, /Voir les résultats →/);
    assert.match(game, /commitDrawItComplete/);
    assert.doesNotMatch(game, /if \(last\) return;/);
    const sessionSrc = read("js/core/drawItSession.js");
    const complete = sessionSrc.slice(
      sessionSrc.indexOf("export async function commitDrawItComplete")
    );
    assert.match(complete, /completeGameSession\(\{\s*gameId: "drawit", screen: "results"/);
    assert.ok(
      complete.indexOf("rpcFinalizeDrawItScores") <
        complete.indexOf("completeGameSession")
    );
  });

  it("C. dernière manche ne crée pas round N+1", () => {
    const { last } = playSeries();
    const refused = applyDrawItNextRound(last, {
      nowMs: Date.parse(last.roundEndsAt) + 1_000,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.session.roundIdx, 2);
    assert.equal(refused.session.phase, DRAW_IT_PHASE_REVEAL);
    const sql = read("supabase/feature-drawit-02-private-word.sql");
    assert.match(sql, /advance_drawit_round/);
    assert.match(sql, /Dernière manche Draw it/);
  });
});

describe("Draw it ! T10 — scores cumulés / classement", () => {
  it("D. scores round 1 + 2 + 3 conservés sans reset", () => {
    const { afterOne, afterTwo, last } = playSeries();
    assert.deepEqual(afterOne.matchScores, { Emma: 10, Lucas: 20, Julie: 15 });
    assert.deepEqual(afterTwo.matchScores, { Emma: 30, Lucas: 25, Julie: 15 });
    assert.deepEqual(last.matchScores, { Emma: 50, Lucas: 40, Julie: 25 });
    assert.equal(last.roundScored, true);
  });

  it("E. classement final : tous les joueurs présents", () => {
    const { last } = playSeries();
    const standings = buildDrawItStandings(last);
    assert.deepEqual(
      standings.map(({ name, score, rank }) => ({ name, score, rank })),
      [
        { name: "Emma", score: 50, rank: 1 },
        { name: "Lucas", score: 40, rank: 2 },
        { name: "Julie", score: 25, rank: 3 },
      ]
    );
    const serialized = serializeLastGameStandings(standings);
    assert.equal(serialized.length, 3);
    const scores = read("js/core/gameScores.js");
    assert.match(scores, /drawit:\s*\{\s*title:\s*"Draw it !"/);
    assert.match(read("js/screens/results.js"), /eveningGameLeaderboardsHtml\(\)/);
  });

  it("L. les points de la dernière manche sont dans le cumul final", () => {
    const { afterTwo, last } = playSeries();
    assert.equal(last.matchScores.Emma, afterTwo.matchScores.Emma + 20);
    assert.equal(last.matchScores.Lucas, afterTwo.matchScores.Lucas + 15);
    assert.equal(last.matchScores.Julie, afterTwo.matchScores.Julie + 10);
    assert.deepEqual(last.lastRound.deltas, {
      Emma: 20,
      Lucas: 15,
      Julie: 10,
    });
    const src = read("js/core/drawItSession.js");
    const revealFn = src.slice(
      src.indexOf("export async function commitDrawItReveal"),
      src.indexOf("export async function commitDrawItNextRound")
    );
    assert.match(revealFn, /matchScores: applied\.session\.matchScores/);
  });
});

describe("Draw it ! T10 — restart / reset", () => {
  it("F. restart : nouveau runId et état propre", () => {
    const previous = playSeries().last;
    const runA = createDrawItRunId();
    const runB = createDrawItRunId();
    assert.notEqual(runA, runB);
    const fresh = buildDrawItLaunchState({
      session: { roundCount: 3, selectedCategoryId: "catalog" },
      participants,
      nowMs: Date.parse("2026-08-16T15:00:00.000Z"),
      runId: runB,
    });
    assert.notEqual(fresh.runId, previous.runId);
    assert.equal(fresh.roundIdx, 0);
    assert.equal(fresh.phase, DRAW_IT_PHASE_DRAWING);
    assert.deepEqual(fresh.matchScores, {});
    assert.equal(fresh.lastRound, null);
    assert.equal(fresh.scoresCommittedRunId, null);
    assert.deepEqual(fresh.strokes, []);
    assert.deepEqual(fresh.guesses, []);
    assert.deepEqual(fresh.foundOrder, []);
    assert.equal(fresh.canvasEpoch, 0);
    const remaining =
      Date.parse(fresh.roundEndsAt) - Date.parse(fresh.roundStartAt);
    assert.equal(remaining, DRAW_IT_ROUND_DURATION_MS);
  });

  it("N. reset nouvelle partie : buffers + prep sans ancien snapshot", () => {
    const buffers = emptyDrawItPlayBuffers();
    assert.deepEqual(buffers, {
      foundOrder: [],
      guesses: [],
      strokes: [],
      canvasEpoch: 0,
      strokeSeq: 0,
    });
    const prep = defaultDrawItPrepSession();
    assert.equal(prep.lobbyStarted, false);
    assert.equal("runId" in prep, false);
    assert.equal("strokes" in prep, false);
    assert.equal("matchScores" in prep, false);
    const restart = read("js/core/restartGame.js");
    assert.match(restart, /export async function launchDrawItPrep/);
    assert.match(restart, /defaultDrawItPrepSession\(\)/);
    const remotePrep = drawItToRemote(prep);
    assert.equal("strokes" in remotePrep, false);
    assert.equal("guesses" in remotePrep, false);
  });
});

describe("Draw it ! T10 — routing / late patch / reconnexion", () => {
  beforeEach(() => {
    __resetCachedGameSessionForTests();
    saveStatePatch({
      inLobby: true,
      lobby: {
        id: LOBBY_ID,
        hostId: EMMA,
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

  it("G. late patch d'un ancien run ne ressuscite pas l'ancien jeu", () => {
    const current = recapRow({
      runId: "run-new",
      lobbyStarted: true,
      phase: DRAW_IT_PHASE_DRAWING,
      updatedAt: "2026-08-16T15:10:00.000Z",
    });
    applyRemoteSession(current);
    const stale = recapRow({
      runId: "run-old",
      lobbyStarted: true,
      phase: DRAW_IT_PHASE_REVEAL,
      roundIdx: 2,
      updatedAt: "2026-08-16T14:00:00.000Z",
      extra: { strokes: [{ strokeId: "old" }] },
    });
    applyRemoteSession(stale);
    assert.equal(isStaleDrawItRound({ runId: "run-new", roundIdx: 0 }, stale.state.drawIt), false);
    assert.equal(isNewDrawItRound({ runId: "run-new", roundIdx: 0 }, stale.state.drawIt), true);
    assert.equal(getDrawItSession().runId, "run-new");
    assert.equal(getDrawItSession().phase, DRAW_IT_PHASE_DRAWING);
  });

  it("H. late patch après results : Draw it ne revient pas", () => {
    const ended = {
      lobby_id: LOBBY_ID,
      game_id: "menu",
      screen: "results",
      updated_at: "2026-08-16T15:20:00.000Z",
      state: {
        drawIt: {
          lobbyStarted: true,
          runId: "run-t10",
          phase: DRAW_IT_PHASE_DRAWING,
          strokes: [{ strokeId: "s1" }],
          guesses: [{ uid: LUCAS, value: "chat" }],
        },
      },
    };
    assert.equal(POST_GAME_SCREENS.has("results"), true);
    assert.equal(getEffectiveSessionScreen(ended), "results");
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(ended, {
        drawIt: { strokes: [{ strokeId: "s1" }], guesses: [] },
      }),
      true
    );
  });

  it("I. reconnexion recap : écran drawit + dessin durable", () => {
    const recap = recapRow({
      extra: {
        strokes: [
          {
            strokeId: "s1",
            seq: 1,
            canvasEpoch: 0,
            color: "#ef4444",
            width: 7,
            points: [
              [0.1, 0.1],
              [0.2, 0.2],
            ],
          },
        ],
        canvasEpoch: 0,
        lastRound: { wordLabel: "chat", foundOrder: [], deltas: {} },
      },
    });
    assert.equal(getEffectiveSessionScreen(recap), "drawit");
    const board = createDrawItRecapBoardFromSession(recap.state.drawIt);
    assert.deepEqual(
      board.strokes.map((entry) => entry.strokeId),
      ["s1"]
    );
    assert.equal(board.currentStroke, null);
  });

  it("J. reconnexion results : écran results, pas drawing", () => {
    const ended = recapRow({
      screen: "results",
      gameId: "menu",
      lobbyStarted: false,
      phase: DRAW_IT_PHASE_REVEAL,
      roundIdx: 2,
    });
    assert.equal(getEffectiveSessionScreen(ended), "results");
    assert.notEqual(getEffectiveSessionScreen(ended), "drawit");
  });

  it("K. multi-client : l'invité suit l'hôte, sans CTA local", () => {
    const game = read("js/games/drawIt.js");
    assert.match(game, /stopGameSessionListenerOnPostGame/);
    assert.match(game, /En attente de l'hôte/);
    assert.match(game, /canActAsHost/);
    const click = game.slice(game.indexOf("app.querySelector(\"#draw-it-advance\")"));
    assert.match(click, /if \(!mp\)/);
    assert.match(click, /navigate\("results"/);
    assert.doesNotMatch(read("js/screens/drawItPrep.js"), /navigate\(\s*["']drawit["']\s*\)/);
  });
});

describe("Draw it ! T10 — confidentialité / CTA", () => {
  it("M. aucune fuite privée sur recap public / results", () => {
    const { last } = playSeries();
    const remote = drawItToRemote(last);
    assert.equal("wordId" in remote, false);
    assert.equal("wordLabel" in remote, false);
    assert.equal("acceptedAnswers" in remote, false);
    assert.equal("deck" in remote, false);
    assert.equal(remote.lastRound.wordLabel, "chat");
    const hydrated = drawItFromRemote(remote);
    assert.equal("acceptedAnswers" in hydrated, false);
    const results = read("js/screens/results.js");
    assert.doesNotMatch(results, /acceptedAnswers/);
    assert.doesNotMatch(results, /wordLabel/);
    assert.doesNotMatch(results, /mountDrawItCanvas/);
  });

  it("O. CTA finaux : contrat REVEAL sans emoji", () => {
    const results = read("js/screens/results.js");
    assert.match(results, /eveningRecapRestartButtonHtml/);
    assert.match(results, />Autre jeu</);
    const restart = read("js/core/restartGame.js");
    assert.match(
      restart,
      /Recommencer une partie de \$\{escapeHtml\(title\)\}/
    );
    assert.doesNotMatch(restart, /Recommencer une partie de .*[🎮🎲✏️]/);
    assert.match(read("js/screens/leaderboard.js"), />Autre jeu</);
    const game = read("js/games/drawIt.js");
    assert.match(game, /Manche suivante →/);
    assert.match(game, /Voir les résultats →/);
    assert.doesNotMatch(game, /Manche suivante 🎮/);
  });
});
