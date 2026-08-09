/**
 * Contrat Consensus fin de partie :
 * dernière révélation → « Voir les résultats » (podium dans results, pas d’écran podium).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);

function completeGameSessionGameId(screen, gameId) {
  return POST_GAME_SCREENS.has(screen) ? "menu" : gameId;
}

function finishConsensusDecision({ mp, canActAsHost, podiumApplied }) {
  if (mp && !canActAsHost) {
    return {
      callCompleteGameSession: false,
      applyLobbyPodium: false,
      setLastGameStandings: false,
      commitPhaseFinal: false,
      navigateResults: false,
    };
  }
  return {
    callCompleteGameSession: Boolean(mp),
    applyLobbyPodium: !podiumApplied,
    setLastGameStandings: !podiumApplied,
    commitPhaseFinal: !podiumApplied,
    navigateResults: !mp,
    screen: mp ? "results" : null,
    gameIdWritten: mp ? completeGameSessionGameId("results", "consensus") : null,
    stayOnPodiumScreen: false,
  };
}

function lastRevealCtaLabel({ questionIdx, totalQuestions }) {
  return questionIdx < totalQuestions - 1 ? "Question suivante →" : "Voir les résultats →";
}

describe("Consensus fin de partie → résultats avec podium (I-PG-01)", () => {
  it("MP host : scoring puis clôture results, pas d’écran podium", () => {
    const d = finishConsensusDecision({
      mp: true,
      canActAsHost: true,
      podiumApplied: false,
    });
    assert.equal(d.stayOnPodiumScreen, false);
    assert.equal(d.applyLobbyPodium, true);
    assert.equal(d.setLastGameStandings, true);
    assert.equal(d.commitPhaseFinal, true);
    assert.equal(d.callCompleteGameSession, true);
    assert.equal(d.screen, "results");
    assert.equal(d.gameIdWritten, "menu");
  });

  it("solo : scoring + navigate results", () => {
    const d = finishConsensusDecision({
      mp: false,
      canActAsHost: true,
      podiumApplied: false,
    });
    assert.equal(d.stayOnPodiumScreen, false);
    assert.equal(d.applyLobbyPodium, true);
    assert.equal(d.navigateResults, true);
    assert.equal(d.callCompleteGameSession, false);
  });

  it("podium déjà appliqué : clôture sans re-score", () => {
    const d = finishConsensusDecision({
      mp: true,
      canActAsHost: true,
      podiumApplied: true,
    });
    assert.equal(d.applyLobbyPodium, false);
    assert.equal(d.setLastGameStandings, false);
    assert.equal(d.callCompleteGameSession, true);
  });

  it("invité : pas de clôture", () => {
    const d = finishConsensusDecision({
      mp: true,
      canActAsHost: false,
      podiumApplied: false,
    });
    assert.equal(d.callCompleteGameSession, false);
    assert.equal(d.applyLobbyPodium, false);
  });

  it("CTA dernière question : Voir les résultats", () => {
    assert.equal(lastRevealCtaLabel({ questionIdx: 0, totalQuestions: 5 }), "Question suivante →");
    assert.equal(lastRevealCtaLabel({ questionIdx: 4, totalQuestions: 5 }), "Voir les résultats →");
  });
});
