/**
 * Contrat Hot Take fin de partie :
 * dernière révélation → « Voir les résultats » (podium dans results, pas de phase final).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);

function completeGameSessionGameId(screen, gameId) {
  return POST_GAME_SCREENS.has(screen) ? "menu" : gameId;
}

function finishHotTakeDecision({ mp, canActAsHost, phase }) {
  if (mp && !canActAsHost) {
    return {
      callCompleteGameSession: false,
      resetBeforeClose: false,
      recordPlayed: false,
      setLastGameStandings: false,
      navigateResults: false,
      commitPhaseFinal: false,
    };
  }
  if (phase === "final") {
    return {
      callCompleteGameSession: Boolean(mp),
      resetBeforeClose: true,
      recordPlayed: false,
      setLastGameStandings: false,
      navigateResults: !mp,
      commitPhaseFinal: false,
    };
  }
  return {
    callCompleteGameSession: Boolean(mp),
    resetBeforeClose: true,
    recordPlayed: true,
    setLastGameStandings: true,
    navigateResults: !mp,
    commitPhaseFinal: false,
    screen: mp ? "results" : null,
    gameIdWritten: mp ? completeGameSessionGameId("results", "hottake") : null,
  };
}

function lastRevealCtaLabel({ takeIdx, total }) {
  return takeIdx < total - 1 ? "Prochain Hot Take →" : "Voir les résultats →";
}

describe("Hot Take fin de partie → résultats avec podium (I-PG-01)", () => {
  it("MP host : dernière manche saute le podium in-game et clôture vers results", () => {
    const d = finishHotTakeDecision({
      mp: true,
      canActAsHost: true,
      phase: "reveal",
    });
    assert.equal(d.commitPhaseFinal, false);
    assert.equal(d.recordPlayed, true);
    assert.equal(d.setLastGameStandings, true);
    assert.equal(d.resetBeforeClose, true);
    assert.equal(d.callCompleteGameSession, true);
    assert.equal(d.screen, "results");
    assert.equal(d.gameIdWritten, "menu");
  });

  it("solo : record + standings puis navigate results, pas de phase final", () => {
    const d = finishHotTakeDecision({
      mp: false,
      canActAsHost: true,
      phase: "reveal",
    });
    assert.equal(d.commitPhaseFinal, false);
    assert.equal(d.recordPlayed, true);
    assert.equal(d.setLastGameStandings, true);
    assert.equal(d.navigateResults, true);
    assert.equal(d.callCompleteGameSession, false);
  });

  it("phase legacy final : clôture sans re-record", () => {
    const d = finishHotTakeDecision({
      mp: true,
      canActAsHost: true,
      phase: "final",
    });
    assert.equal(d.recordPlayed, false);
    assert.equal(d.setLastGameStandings, false);
    assert.equal(d.callCompleteGameSession, true);
    assert.equal(d.resetBeforeClose, true);
  });

  it("invité : pas de clôture depuis finish", () => {
    const d = finishHotTakeDecision({
      mp: true,
      canActAsHost: false,
      phase: "reveal",
    });
    assert.equal(d.callCompleteGameSession, false);
    assert.equal(d.recordPlayed, false);
    assert.equal(d.setLastGameStandings, false);
  });

  it("CTA dernière manche : Voir les résultats (plus Voir le podium)", () => {
    assert.equal(lastRevealCtaLabel({ takeIdx: 0, total: 3 }), "Prochain Hot Take →");
    assert.equal(lastRevealCtaLabel({ takeIdx: 2, total: 3 }), "Voir les résultats →");
  });
});
