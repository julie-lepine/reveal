import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TRIVIA_LOBBY_PODIUM_POINTS } from "../data/trivia.js";
import { podiumPointsForRank, withCompetitionRanks } from "../js/core/competitionRank.js";
import { triviaEveningPoints } from "../js/core/triviaScoring.js";

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
