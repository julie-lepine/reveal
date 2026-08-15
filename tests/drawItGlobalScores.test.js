import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const EMMA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LUCAS = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const JULIE = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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
} = await import("../js/core/drawItRound.js");
const {
  awardDrawItRound,
  buildDrawItStandings,
  drawItRoundScoreDeltas,
} = await import("../js/core/drawItScoring.js");
const { commitDrawItMatchScoresLocal } = await import(
  "../js/core/drawItSession.js"
);
const { drawItFromRemote, drawItToRemote } = await import(
  "../js/core/gameSync.js"
);
const {
  beginGameScoreSession,
  getState,
  resetScores,
  saveStatePatch,
} = await import("../js/core/state.js");

const participants = [
  { userId: EMMA, name: "Emma" },
  { userId: LUCAS, name: "Lucas" },
  { userId: JULIE, name: "Julie" },
];

function launch() {
  return buildDrawItLaunchState({
    session: { roundCount: 3 },
    participants,
    nowMs: Date.parse("2026-08-15T20:00:00.000Z"),
    runId: "run-global-scores",
  });
}

function reveal(session, foundOrder) {
  const scored = applyDrawItReveal(
    { ...session, foundOrder },
    {
      wordLabel: `mot-${session.roundIdx}`,
      nowMs: Date.parse(session.roundEndsAt),
    }
  );
  assert.equal(scored.ok, true);
  return scored.session;
}

function next(session, nowMs) {
  const advanced = applyDrawItNextRound(session, { nowMs });
  assert.equal(advanced.ok, true);
  return advanced.session;
}

function playThreeRounds() {
  let session = launch();
  session = reveal(session, [{ uid: LUCAS }, { uid: JULIE }]);
  const afterOne = session;
  session = next(session, Date.parse("2026-08-15T20:01:10.000Z"));
  session = reveal(session, [{ uid: EMMA }]);
  const afterTwo = session;
  session = next(session, Date.parse("2026-08-15T20:02:20.000Z"));
  session = reveal(session, [{ uid: EMMA }, { uid: LUCAS }]);
  return { afterOne, afterTwo, afterThree: session };
}

describe("Draw it ! — barème et cumul de trois manches", () => {
  it("applique 20/15/10 puis 5 et +5 au drawer par trouveur", () => {
    const fourPlayers = {
      participants: [
        ...participants,
        { userId: "dddddddd-dddd-dddd-dddd-dddddddddddd", name: "Noah" },
        { userId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", name: "Mia" },
      ],
      drawerUid: EMMA,
      foundOrder: [
        { uid: LUCAS },
        { uid: JULIE },
        { uid: "dddddddd-dddd-dddd-dddd-dddddddddddd" },
        { uid: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" },
      ],
    };
    assert.deepEqual(drawItRoundScoreDeltas(fourPlayers), {
      Emma: 20,
      Lucas: 20,
      Julie: 15,
      Noah: 10,
      Mia: 5,
    });
  });

  it("cumule exactement les trois deltas sans reset entre manches", () => {
    const { afterOne, afterTwo, afterThree } = playThreeRounds();
    assert.deepEqual(afterOne.matchScores, { Emma: 10, Lucas: 20, Julie: 15 });
    assert.deepEqual(afterTwo.matchScores, { Emma: 30, Lucas: 25, Julie: 15 });
    assert.deepEqual(afterThree.matchScores, { Emma: 50, Lucas: 40, Julie: 25 });
    assert.deepEqual(afterThree.lastRound.deltas, {
      Emma: 20,
      Lucas: 15,
      Julie: 10,
    });
  });

  it("une manche sans trouveur ajoute zéro sans effacer le cumul", () => {
    const { afterOne } = playThreeRounds();
    const second = next(afterOne, Date.parse("2026-08-15T20:01:10.000Z"));
    const noFinder = reveal(second, []);
    assert.deepEqual(noFinder.lastRound.deltas, {
      Emma: 0,
      Lucas: 0,
      Julie: 0,
    });
    assert.deepEqual(noFinder.matchScores, afterOne.matchScores);
  });

  it("runId + roundIdx déjà scoré ne peut pas être recrédité", () => {
    const { afterOne } = playThreeRounds();
    const duplicate = awardDrawItRound(afterOne);
    assert.equal(duplicate.applied, false);
    assert.equal(duplicate.scoreKey, "run-global-scores:0");
    assert.deepEqual(duplicate.matchScores, afterOne.matchScores);
  });

  it("le dernier delta est présent avant completion et le classement est cumulé", () => {
    const { afterThree } = playThreeRounds();
    assert.equal(afterThree.roundScored, true);
    assert.deepEqual(
      buildDrawItStandings(afterThree).map(({ name, score, rank }) => ({
        name,
        score,
        rank,
      })),
      [
        { name: "Emma", score: 50, rank: 1 },
        { name: "Lucas", score: 40, rank: 2 },
        { name: "Julie", score: 25, rank: 3 },
      ]
    );
  });
});

describe("Draw it ! — intégration scores REVEAL", () => {
  beforeEach(() => {
    resetScores();
    saveStatePatch({
      lobby: {
        id: "11111111-1111-1111-1111-111111111111",
        participants,
      },
    });
    beginGameScoreSession("drawit");
  });

  it("transfère le cumul vers scores/gameScores une seule fois", () => {
    const { afterThree } = playThreeRounds();
    commitDrawItMatchScoresLocal(afterThree);
    commitDrawItMatchScoresLocal(afterThree);
    const state = getState();
    assert.deepEqual(state.gameScores.drawit, {
      Emma: 50,
      Lucas: 40,
      Julie: 25,
    });
    assert.equal(state.scores.Emma, 50);
    assert.equal(state.scores.Lucas, 40);
    assert.equal(state.scores.Julie, 25);
    assert.equal(state.eveningGamesRecorded.drawit, true);
  });

  it("refresh / reconnexion conserve le cumul et ne rescrore pas le round", () => {
    const { afterThree } = playThreeRounds();
    const hydrated = drawItFromRemote(drawItToRemote(afterThree));
    assert.deepEqual(hydrated.matchScores, afterThree.matchScores);
    assert.deepEqual(hydrated.lastRound.deltas, afterThree.lastRound.deltas);
    assert.equal(awardDrawItRound(hydrated).applied, false);
  });

  it("results/leaderboard possèdent le mapping Draw it existant", () => {
    const scores = read("js/core/gameScores.js");
    const results = read("js/screens/results.js");
    assert.match(scores, /drawit:\s*\{\s*title:\s*"Draw it !"/);
    assert.match(results, /eveningGameLeaderboardsHtml\(\)/);
    assert.match(results, /lastGamePodiumHtml\(last\)/);
  });

  it("SQL score le reveal et finalise le run de façon idempotente", () => {
    const sql = read("supabase/feature-drawit-02-private-word.sql");
    assert.match(sql, /drawit_round_score_deltas/);
    assert.match(sql, /'matchScores', v_match_scores/);
    assert.match(sql, /'deltas', v_deltas/);
    assert.match(sql, /create or replace function public\.finalize_drawit_scores/);
    assert.match(sql, /scoresCommittedRunId/);
    assert.match(sql, /if coalesce\(v_di->>'scoresCommittedRunId', ''\) = v_run then/);
    assert.match(sql, /'gameScores', v_game_scores/);
    assert.match(sql, /'eveningGamesRecorded', v_recorded/);
  });

  it("le client finalise les scores avant completeGameSession", () => {
    const src = read("js/core/drawItSession.js");
    const start = src.indexOf("export async function commitDrawItComplete");
    const end = src.indexOf("/**", start + 10);
    const fn = src.slice(start, end);
    assert.ok(fn.indexOf("rpcFinalizeDrawItScores") >= 0);
    assert.ok(
      fn.indexOf("rpcFinalizeDrawItScores") <
        fn.indexOf("completeGameSession")
    );
  });
});
