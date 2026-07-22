/**
 * Contrat I-PG-01 étape A : fin Consensus MP = podium in-game, puis clôture explicite.
 * Miroir de finishConsensusGame / showEveningResults (consensus.js), sans monter le DOM.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);

function completeGameSessionGameId(screen, gameId) {
  return POST_GAME_SCREENS.has(screen) ? "menu" : gameId;
}

/** Décision finishConsensusGame (branche MP host / solo / podium déjà appliqué). */
function finishConsensusDecision({ mp, canActAsHost, podiumApplied }) {
  if (podiumApplied) {
    return {
      callCompleteGameSession: false,
      commitScreen: null,
      renderPodium: true,
      phase: "final",
    };
  }
  if (mp && canActAsHost) {
    return {
      callCompleteGameSession: false,
      commitScreen: "consensus",
      renderPodium: true,
      phase: "final",
    };
  }
  if (!mp) {
    return {
      callCompleteGameSession: false,
      commitScreen: null,
      renderPodium: true,
      phase: "final",
      soloSave: true,
    };
  }
  return {
    callCompleteGameSession: false,
    commitScreen: null,
    renderPodium: false,
  };
}

/** Décision showEveningResults. */
function showEveningResultsDecision({ mp, canActAsHost }) {
  if (mp) {
    if (!canActAsHost) {
      return { callCompleteGameSession: false, navigateResults: false };
    }
    return {
      callCompleteGameSession: true,
      screen: "results",
      gameIdWritten: completeGameSessionGameId("results", "consensus"),
      navigateResults: false,
    };
  }
  return {
    callCompleteGameSession: false,
    navigateResults: true,
  };
}

/** Qui voit le CTA podium (miroir render). */
function podiumChrome({ mp, isLobbyHost, canActAsHost }) {
  return {
    showHostActions: !mp || isLobbyHost,
    showContinueAction: !mp || canActAsHost,
  };
}

describe("Consensus MP podium stay-on-game (I-PG-01 A)", () => {
  it("MP host : finishConsensusGame n’appelle pas completeGameSession", () => {
    const d = finishConsensusDecision({
      mp: true,
      canActAsHost: true,
      podiumApplied: false,
    });
    assert.equal(d.callCompleteGameSession, false);
  });

  it("MP host : session écrite reste screen consensus + phase final + render podium", () => {
    const d = finishConsensusDecision({
      mp: true,
      canActAsHost: true,
      podiumApplied: false,
    });
    assert.equal(d.commitScreen, "consensus");
    assert.equal(d.phase, "final");
    assert.equal(d.renderPodium, true);
  });

  it("podium déjà appliqué : render podium, pas de clôture silencieuse", () => {
    const d = finishConsensusDecision({
      mp: true,
      canActAsHost: true,
      podiumApplied: true,
    });
    assert.equal(d.callCompleteGameSession, false);
    assert.equal(d.renderPodium, true);
  });

  it("solo : podium rendu, pas de completeGameSession", () => {
    const d = finishConsensusDecision({
      mp: false,
      canActAsHost: true,
      podiumApplied: false,
    });
    assert.equal(d.renderPodium, true);
    assert.equal(d.callCompleteGameSession, false);
    assert.equal(d.soloSave, true);
  });

  it("CTA Voir les résultats (MP host) → completeGameSession screen results + game_id menu", () => {
    const d = showEveningResultsDecision({ mp: true, canActAsHost: true });
    assert.equal(d.callCompleteGameSession, true);
    assert.equal(d.screen, "results");
    assert.equal(d.gameIdWritten, "menu");
    assert.equal(d.navigateResults, false);
  });

  it("invité : pas de CTA clôture, pas de completeGameSession", () => {
    const evening = showEveningResultsDecision({ mp: true, canActAsHost: false });
    assert.equal(evening.callCompleteGameSession, false);
    const chrome = podiumChrome({
      mp: true,
      isLobbyHost: false,
      canActAsHost: false,
    });
    assert.equal(chrome.showContinueAction, false);
    assert.equal(chrome.showHostActions, false);
  });

  it("acting host non-lobby-host : CTA résultats, pas les actions replay hôte", () => {
    const chrome = podiumChrome({
      mp: true,
      isLobbyHost: false,
      canActAsHost: true,
    });
    assert.equal(chrome.showContinueAction, true);
    assert.equal(chrome.showHostActions, false);
    const evening = showEveningResultsDecision({ mp: true, canActAsHost: true });
    assert.equal(evening.callCompleteGameSession, true);
  });
});
