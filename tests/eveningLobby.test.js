import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  beginGameScoreSession,
  defaultEveningStats,
  getActiveScoringGame,
  getState,
  hasEveningStatsActivity,
  mergeEveningGamesRecorded,
  recordHotTakePlayed,
  recordSpeedVotePlayed,
  recordWrongAnswerPlayed,
  resetScores,
  saveStatePatch,
} from "../js/core/state.js";

describe("hasEveningStatsActivity", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("faux avant toute partie", () => {
    saveStatePatch({ stats: defaultEveningStats(), scores: {}, eveningGamesRecorded: {} });
    assert.equal(hasEveningStatsActivity(), false);
  });

  it("vrai après des points enregistrés", () => {
    saveStatePatch({
      stats: defaultEveningStats(),
      scores: { Alice: 3 },
      eveningGamesRecorded: {},
    });
    assert.equal(hasEveningStatsActivity(), true);
  });

  it("vrai après une partie comptabilisée", () => {
    saveStatePatch({
      stats: { ...defaultEveningStats(), traitreGamesPlayed: 1 },
      scores: {},
      eveningGamesRecorded: {},
    });
    assert.equal(hasEveningStatsActivity(), true);
  });

  it("vrai après Clutch ou Wrong Answer", () => {
    saveStatePatch({
      stats: { ...defaultEveningStats(), clutchesPlayed: 1 },
      scores: {},
      eveningGamesRecorded: {},
    });
    assert.equal(hasEveningStatsActivity(), true);

    saveStatePatch({
      stats: { ...defaultEveningStats(), wrongAnswersPlayed: 1 },
      scores: {},
      eveningGamesRecorded: {},
    });
    assert.equal(hasEveningStatsActivity(), true);
  });

  it("fusionne les jeux deja comptes sans regression", () => {
    const merged = mergeEveningGamesRecorded(
      { clutch: true, hottake: false },
      { wronganswer: true, clutch: true }
    );

    assert.deepEqual(merged, { clutch: true, wronganswer: true });
  });

  it("affiche les jeux termines meme sans point marque", () => {
    saveStatePatch({
      stats: defaultEveningStats(),
      gameScores: {},
      gameScoreOrder: [],
      eveningGamesRecorded: {},
    });

    recordHotTakePlayed();
    recordSpeedVotePlayed();
    recordWrongAnswerPlayed();

    assert.deepEqual(getState().gameScoreOrder, ["hottake", "speedvote", "wronganswer"]);
    assert.deepEqual(getState().gameScores.hottake, {});
    assert.deepEqual(getState().gameScores.speedvote, {});
    assert.deepEqual(getState().gameScores.wronganswer, {});
  });

  it("repare un jeu deja compte mais absent des resultats", () => {
    saveStatePatch({
      stats: { ...defaultEveningStats(), hotTakesPlayed: 1 },
      gameScores: {},
      gameScoreOrder: [],
      eveningGamesRecorded: { hottake: true },
    });

    recordHotTakePlayed();

    assert.deepEqual(getState().gameScoreOrder, ["hottake"]);
    assert.deepEqual(getState().gameScores.hottake, {});
    assert.equal(getState().stats.hotTakesPlayed, 1);
  });

  it("resetScores oublie le jeu actif de scoring", () => {
    beginGameScoreSession("hottake");
    assert.equal(getActiveScoringGame(), "hottake");

    resetScores();

    assert.equal(getActiveScoringGame(), null);
  });
});
