/**
 * Contrat Hot Take B2 : podium in-game (phase final) puis clôture explicite.
 * Miroir de finishHotTakeGame / showEveningResults (hotTake.js).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);

function completeGameSessionGameId(screen, gameId) {
  return POST_GAME_SCREENS.has(screen) ? "menu" : gameId;
}

function finishHotTakeDecision({ mp, canActAsHost, phase }) {
  if (phase === "final") {
    return {
      callCompleteGameSession: false,
      resetBeforeClose: false,
      recordPlayed: false,
      commitScreen: null,
      renderPodium: true,
      phase: "final",
    };
  }
  if (mp && canActAsHost) {
    return {
      callCompleteGameSession: false,
      resetBeforeClose: false,
      recordPlayed: true,
      commitScreen: "hottake",
      renderPodium: true,
      phase: "final",
    };
  }
  if (!mp) {
    return {
      callCompleteGameSession: false,
      resetBeforeClose: false,
      recordPlayed: true,
      commitScreen: null,
      renderPodium: true,
      phase: "final",
      soloSave: true,
    };
  }
  return {
    callCompleteGameSession: false,
    resetBeforeClose: false,
    recordPlayed: false,
    renderPodium: false,
  };
}

function showEveningResultsDecision({ mp, canActAsHost }) {
  if (mp) {
    if (!canActAsHost) {
      return {
        callCompleteGameSession: false,
        resetBeforeClose: false,
        navigateResults: false,
      };
    }
    return {
      callCompleteGameSession: true,
      resetBeforeClose: true,
      screen: "results",
      gameIdWritten: completeGameSessionGameId("results", "hottake"),
      navigateResults: false,
    };
  }
  return {
    callCompleteGameSession: false,
    resetBeforeClose: true,
    navigateResults: true,
  };
}

function podiumChrome({ mp, canActAsHost }) {
  return {
    showContinueAction: !mp || canActAsHost,
  };
}

describe("Hot Take MP podium stay-on-game (I-PG-01 B2)", () => {
  it("MP host : finishHotTakeGame n’appelle pas completeGameSession", () => {
    const d = finishHotTakeDecision({
      mp: true,
      canActAsHost: true,
      phase: "reveal",
    });
    assert.equal(d.callCompleteGameSession, false);
    assert.equal(d.resetBeforeClose, false);
  });

  it("MP host : session écrite screen hottake + phase final + render podium", () => {
    const d = finishHotTakeDecision({
      mp: true,
      canActAsHost: true,
      phase: "reveal",
    });
    assert.equal(d.commitScreen, "hottake");
    assert.equal(d.phase, "final");
    assert.equal(d.renderPodium, true);
    assert.equal(d.recordPlayed, true);
  });

  it("phase déjà final : render only, pas de record / reset / clôture", () => {
    const d = finishHotTakeDecision({
      mp: true,
      canActAsHost: true,
      phase: "final",
    });
    assert.equal(d.renderPodium, true);
    assert.equal(d.recordPlayed, false);
    assert.equal(d.callCompleteGameSession, false);
    assert.equal(d.resetBeforeClose, false);
  });

  it("solo : podium rendu, pas de completeGameSession, pas de reset anticipé", () => {
    const d = finishHotTakeDecision({
      mp: false,
      canActAsHost: true,
      phase: "reveal",
    });
    assert.equal(d.renderPodium, true);
    assert.equal(d.callCompleteGameSession, false);
    assert.equal(d.resetBeforeClose, false);
    assert.equal(d.soloSave, true);
  });

  it("CTA Voir les résultats (MP host) → reset puis completeGameSession results + game_id menu", () => {
    const d = showEveningResultsDecision({ mp: true, canActAsHost: true });
    assert.equal(d.resetBeforeClose, true);
    assert.equal(d.callCompleteGameSession, true);
    assert.equal(d.screen, "results");
    assert.equal(d.gameIdWritten, "menu");
    assert.equal(d.navigateResults, false);
  });

  it("invité : pas de CTA clôture, pas de completeGameSession", () => {
    const evening = showEveningResultsDecision({ mp: true, canActAsHost: false });
    assert.equal(evening.callCompleteGameSession, false);
    assert.equal(evening.resetBeforeClose, false);
    const chrome = podiumChrome({ mp: true, canActAsHost: false });
    assert.equal(chrome.showContinueAction, false);
  });

  it("acting host : CTA résultats + clôture autorisée", () => {
    const chrome = podiumChrome({ mp: true, canActAsHost: true });
    assert.equal(chrome.showContinueAction, true);
    const evening = showEveningResultsDecision({ mp: true, canActAsHost: true });
    assert.equal(evening.callCompleteGameSession, true);
  });

  it("finish ne reset pas ; seul showEveningResults reset avant clôture", () => {
    const finish = finishHotTakeDecision({
      mp: true,
      canActAsHost: true,
      phase: "reveal",
    });
    const evening = showEveningResultsDecision({ mp: true, canActAsHost: true });
    assert.equal(finish.resetBeforeClose, false);
    assert.equal(evening.resetBeforeClose, true);
  });
});
