/**
 * Contrat Trivia fin de partie :
 * dernière révélation → scoring podium → « Voir les résultats » (podium dans results).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TRIVIA_LOBBY_PODIUM_POINTS } from "../data/trivia.js";
import { podiumPointsForRank, withCompetitionRanks } from "../js/core/competitionRank.js";
import { triviaEveningPoints } from "../js/core/triviaScoring.js";

const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);

function completeGameSessionGameId(screen, gameId) {
  return POST_GAME_SCREENS.has(screen) ? "menu" : gameId;
}

/** Miroir du pipeline applyTriviaLobbyPodium sans charger gameSync. */
function eveningCreditsFromMatchScores(matchScores) {
  const standings = withCompetitionRanks(
    Object.entries(matchScores)
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    (p) => p.score
  ).map((player) => ({
    ...player,
    lobbyBonus: podiumPointsForRank(player.rank, TRIVIA_LOBBY_PODIUM_POINTS),
  }));
  return Object.fromEntries(
    standings.map((p) => [p.name, triviaEveningPoints(p)])
  );
}

function finishTriviaDecision({ mp, canActAsHost, podiumApplied, eveningPodiumApplied }) {
  if (mp && !canActAsHost) {
    return {
      callCompleteGameSession: false,
      commitFinalPlay: false,
      applyLobbyPodium: false,
      setLastGameStandings: false,
      navigateResults: false,
      stayOnPodiumScreen: false,
    };
  }
  const needScore = mp ? !podiumApplied || !eveningPodiumApplied : !eveningPodiumApplied;
  return {
    callCompleteGameSession: Boolean(mp),
    commitFinalPlay: Boolean(mp) && !podiumApplied,
    applyLobbyPodium: needScore && (mp ? !eveningPodiumApplied : true),
    setLastGameStandings: !eveningPodiumApplied,
    navigateResults: !mp,
    stayOnPodiumScreen: false,
    screen: mp ? "results" : null,
    gameIdWritten: mp ? completeGameSessionGameId("results", "trivia") : null,
  };
}

function lastRevealCtaLabel({ questionIdx, totalQuestions }) {
  return questionIdx < totalQuestions - 1 ? "Question suivante →" : "Voir les résultats →";
}

describe("triviaEveningPoints", () => {
  it("somme quiz + bonus podium", () => {
    assert.equal(triviaEveningPoints({ score: 40, lobbyBonus: 15 }), 55);
    assert.equal(triviaEveningPoints({ score: 20, lobbyBonus: 0 }), 20);
    assert.equal(triviaEveningPoints({ score: 0, lobbyBonus: 5 }), 5);
  });

  it("ignore score / bonus non numériques", () => {
    assert.equal(triviaEveningPoints({ score: "10", lobbyBonus: 15 }), 15);
    assert.equal(triviaEveningPoints({}), 0);
  });
});

describe("crédit soirée Trivia (matchScores + podium)", () => {
  it("crédite cumul quiz et bonus podium", () => {
    assert.deepEqual(
      eveningCreditsFromMatchScores({ Alice: 40, Bob: 25, Carla: 10 }),
      { Alice: 40 + 15, Bob: 25 + 10, Carla: 10 + 5 }
    );
  });

  it("crédite le quiz hors podium (4e)", () => {
    assert.deepEqual(
      eveningCreditsFromMatchScores({ Alice: 50, Bob: 40, Carla: 30, Dan: 20 }),
      { Alice: 50 + 15, Bob: 40 + 10, Carla: 30 + 5, Dan: 20 }
    );
  });
});

describe("Trivia fin de partie → résultats avec podium", () => {
  it("MP host : commit final + crédit soirée puis results", () => {
    const d = finishTriviaDecision({
      mp: true,
      canActAsHost: true,
      podiumApplied: false,
      eveningPodiumApplied: false,
    });
    assert.equal(d.stayOnPodiumScreen, false);
    assert.equal(d.commitFinalPlay, true);
    assert.equal(d.applyLobbyPodium, true);
    assert.equal(d.setLastGameStandings, true);
    assert.equal(d.callCompleteGameSession, true);
    assert.equal(d.gameIdWritten, "menu");
  });

  it("solo : crédit puis navigate results", () => {
    const d = finishTriviaDecision({
      mp: false,
      canActAsHost: true,
      podiumApplied: false,
      eveningPodiumApplied: false,
    });
    assert.equal(d.stayOnPodiumScreen, false);
    assert.equal(d.navigateResults, true);
    assert.equal(d.applyLobbyPodium, true);
    assert.equal(d.callCompleteGameSession, false);
  });

  it("invité : pas de clôture", () => {
    const d = finishTriviaDecision({
      mp: true,
      canActAsHost: false,
      podiumApplied: false,
      eveningPodiumApplied: false,
    });
    assert.equal(d.callCompleteGameSession, false);
    assert.equal(d.commitFinalPlay, false);
  });

  it("CTA dernière question : Voir les résultats", () => {
    assert.equal(lastRevealCtaLabel({ questionIdx: 1, totalQuestions: 10 }), "Question suivante →");
    assert.equal(lastRevealCtaLabel({ questionIdx: 9, totalQuestions: 10 }), "Voir les résultats →");
  });
});
