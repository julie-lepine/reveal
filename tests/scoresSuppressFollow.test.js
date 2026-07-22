/**
 * Miroir des gardes suppress scores vs relance hôte (chemin volontaire goToScores).
 * Aligné sur isSessionAdvancedFromSuppress (gameSync.js).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);
const GAME_SETUP_SCREENS = new Set([
  "consensus-prep",
  "hottake-prep",
  "trivia-prep",
]);

function sessionSignature(row) {
  if (!row) return "";
  return `${row.screen}|${JSON.stringify(row.state || {})}`;
}

function isOnGameSetupScreen(screen) {
  return GAME_SETUP_SCREENS.has(screen);
}

function isActiveGameSessionScreen(screen) {
  if (!screen || screen === "home" || screen === "lobby" || screen === "game-select") return false;
  if (POST_GAME_SCREENS.has(screen)) return false;
  return true;
}

function isCompatibleSessionScreen(sessionScreen, localScreen) {
  if (sessionScreen === localScreen) return true;
  if (
    (sessionScreen === "results" && localScreen === "leaderboard") ||
    (sessionScreen === "leaderboard" && localScreen === "results")
  ) {
    return true;
  }
  if (
    (localScreen === "results" || localScreen === "leaderboard") &&
    (sessionScreen === "game-select" ||
      sessionScreen === "lobby" ||
      POST_GAME_SCREENS.has(sessionScreen))
  ) {
    return true;
  }
  if (sessionScreen === "game-select") {
    if (isOnGameSetupScreen(localScreen) || isActiveGameSessionScreen(localScreen)) {
      return true;
    }
  }
  return false;
}

function shouldForceGuestFollowSession(screen) {
  return isOnGameSetupScreen(screen) || isActiveGameSessionScreen(screen);
}

/** Miroir partiel de routeToActiveGameIfNeeded sous suppress scores. */
function routeDecisionUnderScoresSuppress({
  effective,
  current = "results",
  suppressScreen,
  suppressSig,
  cachedRow,
}) {
  if (!effective) return { routed: false, reason: "no_effective_screen" };
  const isEveningHub = effective === "game-select";
  if (!isEveningHub && !isActiveGameSessionScreen(effective) && !isOnGameSetupScreen(effective)) {
    return { routed: false, reason: "effective_screen_post_game_only" };
  }
  if (current === effective) return { routed: true, reason: "already_on_target_screen" };
  const browsing = POST_GAME_SCREENS.has(current);
  if (
    browsing &&
    !isSessionAdvancedFromSuppress(effective, { suppressScreen, suppressSig, cachedRow })
  ) {
    return { routed: false, reason: "scores_suppress_blocks" };
  }
  const apply = shouldApplyWithScoresSuppress({
    effective,
    suppressScreen,
    suppressSig,
    cachedRow,
  });
  if (!apply.allow) return { routed: false, reason: apply.reason };
  return { routed: true, reason: "navigate" };
}

/** Miroir de isSessionAdvancedFromSuppress (gameSync.js) après patch hub-prep-v3. */
function isSessionAdvancedFromSuppress(targetScreen, { suppressScreen, suppressSig, cachedRow }) {
  const currentSig = sessionSignature(cachedRow);
  const forceFollow = shouldForceGuestFollowSession(targetScreen);
  const suppressFromHubOrPost =
    suppressScreen === "game-select" ||
    suppressScreen === "lobby" ||
    POST_GAME_SCREENS.has(suppressScreen);
  const sameScreen = Boolean(suppressScreen && targetScreen && targetScreen === suppressScreen);
  const compatible = Boolean(
    suppressScreen && targetScreen && isCompatibleSessionScreen(suppressScreen, targetScreen)
  );

  if (!targetScreen) return false;
  if (!suppressScreen) {
    return forceFollow;
  }
  if (suppressSig && currentSig !== suppressSig) return true;
  if (sameScreen) return false;
  if (forceFollow && (!suppressSig || suppressFromHubOrPost)) return true;
  if (forceFollow && shouldForceGuestFollowSession(suppressScreen)) return true;
  if (compatible) return false;
  return true;
}

function shouldApplyWithScoresSuppress({ effective, suppressScreen, suppressSig, cachedRow }) {
  if (isSessionAdvancedFromSuppress(effective, { suppressScreen, suppressSig, cachedRow })) {
    return { allow: true, reason: "scores_suppress_bypass_session_advanced" };
  }
  if (POST_GAME_SCREENS.has(effective)) {
    return { allow: false, reason: "scores_suppress_stay_post_game" };
  }
  if (shouldForceGuestFollowSession(effective)) {
    return { allow: false, reason: "scores_suppress_blocks_force_follow" };
  }
  return { allow: false, reason: "scores_suppress_blocks" };
}

describe("goToScores suppress vs host launch", () => {
  const resultsRow = {
    screen: "results",
    state: { consensus: { lobbyStarted: false, phase: "final" } },
  };
  const resultsRowScoreBump = {
    screen: "results",
    state: {
      consensus: { lobbyStarted: false, phase: "final" },
      scores: { Alice: 12 },
    },
  };
  const leaderboardRow = {
    screen: "leaderboard",
    state: { scores: { Alice: 10 } },
  };
  const hubRow = {
    screen: "game-select",
    state: { scores: { A: 1 } },
  };
  const consensusPrepRow = {
    screen: "consensus-prep",
    state: { consensus: { lobbyStarted: false, ready: {} } },
  };
  const consensusPrepRelaunch = {
    screen: "consensus-prep",
    state: { consensus: { lobbyStarted: false, ready: {}, roundCount: 7 } },
  };
  const hotTakePrepRow = {
    screen: "hottake-prep",
    state: { hotTake: { lobbyStarted: false, ready: {} } },
  };

  it("1. game-select + suppressSig null → hottake-prep : navigation autorisée", () => {
    const decision = routeDecisionUnderScoresSuppress({
      effective: "hottake-prep",
      suppressScreen: "game-select",
      suppressSig: "",
      cachedRow: hotTakePrepRow,
    });
    assert.equal(decision.routed, true);
    assert.equal(decision.reason, "navigate");
  });

  it("1b. suppressScreen null + suppressSig null + hottake-prep → advanced true", () => {
    assert.equal(
      isSessionAdvancedFromSuppress("hottake-prep", {
        suppressScreen: null,
        suppressSig: null,
        cachedRow: hotTakePrepRow,
      }),
      true
    );
    const decision = routeDecisionUnderScoresSuppress({
      effective: "hottake-prep",
      suppressScreen: null,
      suppressSig: null,
      cachedRow: hotTakePrepRow,
    });
    assert.equal(decision.routed, true);
    assert.equal(decision.reason, "navigate");
  });

  it("1c. suppressScreen null + target results → advanced false (rester sur scores)", () => {
    assert.equal(
      isSessionAdvancedFromSuppress("results", {
        suppressScreen: null,
        suppressSig: null,
        cachedRow: resultsRow,
      }),
      false
    );
  });

  it("2. results → même session/signature : navigation bloquée", () => {
    const sig = sessionSignature(resultsRow);
    const decision = routeDecisionUnderScoresSuppress({
      effective: "results",
      suppressScreen: "results",
      suppressSig: sig,
      cachedRow: resultsRow,
    });
    assert.equal(decision.routed, false);
    assert.equal(decision.reason, "effective_screen_post_game_only");
  });

  it("3. results → simple mise à jour des scores : navigation bloquée", () => {
    const decision = routeDecisionUnderScoresSuppress({
      effective: "results",
      suppressScreen: "results",
      suppressSig: sessionSignature(resultsRow),
      cachedRow: resultsRowScoreBump,
    });
    assert.equal(decision.routed, false);
    assert.equal(decision.reason, "effective_screen_post_game_only");
  });

  it("4. results → nouvelle prep d’un autre jeu : navigation autorisée", () => {
    const decision = routeDecisionUnderScoresSuppress({
      effective: "hottake-prep",
      suppressScreen: "results",
      suppressSig: sessionSignature(resultsRow),
      cachedRow: hotTakePrepRow,
    });
    assert.equal(decision.routed, true);
    assert.equal(decision.reason, "navigate");
  });

  it("5. results → relance du même jeu avec nouvelle signature : navigation autorisée", () => {
    const decision = routeDecisionUnderScoresSuppress({
      effective: "consensus-prep",
      suppressScreen: "results",
      suppressSig: sessionSignature(resultsRow),
      cachedRow: consensusPrepRelaunch,
    });
    assert.equal(decision.routed, true);
    assert.equal(decision.reason, "navigate");
  });

  it("6. leaderboard → nouvelle prep : navigation autorisée", () => {
    const decision = routeDecisionUnderScoresSuppress({
      effective: "hottake-prep",
      current: "leaderboard",
      suppressScreen: "leaderboard",
      suppressSig: sessionSignature(leaderboardRow),
      cachedRow: hotTakePrepRow,
    });
    assert.equal(decision.routed, true);
    assert.equal(decision.reason, "navigate");
  });

  it("7. même prep et même signature : navigation bloquée", () => {
    const sig = sessionSignature(consensusPrepRow);
    const decision = routeDecisionUnderScoresSuppress({
      effective: "consensus-prep",
      suppressScreen: "consensus-prep",
      suppressSig: sig,
      cachedRow: consensusPrepRow,
    });
    assert.equal(decision.routed, false);
    assert.equal(decision.reason, "scores_suppress_blocks");
  });

  it("8. row post-partie différente sans nouveau lancement : navigation bloquée", () => {
    const decision = routeDecisionUnderScoresSuppress({
      effective: "leaderboard",
      suppressScreen: "results",
      suppressSig: sessionSignature(resultsRow),
      cachedRow: leaderboardRow,
    });
    assert.equal(decision.routed, false);
    assert.equal(decision.reason, "effective_screen_post_game_only");
  });

  it("hub + sig → prep : toujours autorisé", () => {
    const decision = routeDecisionUnderScoresSuppress({
      effective: "consensus-prep",
      suppressScreen: "game-select",
      suppressSig: sessionSignature(hubRow),
      cachedRow: consensusPrepRow,
    });
    assert.equal(decision.routed, true);
  });

  it("isCompatibleSessionScreen(game-select, prep) reste true mais n'empêche plus l'avancement", () => {
    assert.equal(isCompatibleSessionScreen("game-select", "hottake-prep"), true);
    assert.equal(
      isSessionAdvancedFromSuppress("hottake-prep", {
        suppressScreen: "game-select",
        suppressSig: "",
        cachedRow: hotTakePrepRow,
      }),
      true
    );
  });
});
