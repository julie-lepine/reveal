/**
 * Miroir des gardes suppress scores vs relance hôte (chemin volontaire goToScores).
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

function isSessionAdvancedFromSuppress(targetScreen, { suppressScreen, suppressSig, cachedRow }) {
  if (!suppressScreen || !targetScreen) return false;
  if (suppressSig && sessionSignature(cachedRow) !== suppressSig) {
    return true;
  }
  if (targetScreen === suppressScreen) return false;
  if (isCompatibleSessionScreen(suppressScreen, targetScreen)) return false;
  return true;
}

function shouldForceGuestFollowSession(screen) {
  return isOnGameSetupScreen(screen) || isActiveGameSessionScreen(screen);
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
  const hubRow = {
    screen: "game-select",
    state: { scores: { A: 1 } },
  };
  const prepRow = {
    screen: "consensus-prep",
    state: { consensus: { lobbyStarted: false, ready: {} } },
  };

  it("chemin auto : pas de suppress → force follow (équivalent)", () => {
    assert.equal(shouldForceGuestFollowSession("consensus-prep"), true);
  });

  it("goToScores depuis session results : sig change à la prep → bypass OK", () => {
    const suppressSig = sessionSignature(resultsRow);
    const decision = shouldApplyWithScoresSuppress({
      effective: "consensus-prep",
      suppressScreen: "results",
      suppressSig,
      cachedRow: prepRow,
    });
    assert.equal(decision.allow, true);
    assert.equal(decision.reason, "scores_suppress_bypass_session_advanced");
  });

  it("RÉGRESSION : suppressScreen=game-select + suppressSig vide → prep considérée non avancée", () => {
    const decision = shouldApplyWithScoresSuppress({
      effective: "consensus-prep",
      suppressScreen: "game-select",
      suppressSig: "",
      cachedRow: prepRow,
    });
    // isCompatibleSessionScreen("game-select", "consensus-prep") === true
    // → advanced false → scores_suppress_blocks_force_follow
    assert.equal(decision.allow, false);
    assert.equal(decision.reason, "scores_suppress_blocks_force_follow");
  });

  it("suppressScreen=game-select + sig hub→prep change → bypass OK", () => {
    const decision = shouldApplyWithScoresSuppress({
      effective: "consensus-prep",
      suppressScreen: "game-select",
      suppressSig: sessionSignature(hubRow),
      cachedRow: prepRow,
    });
    assert.equal(decision.allow, true);
    assert.equal(decision.reason, "scores_suppress_bypass_session_advanced");
  });

  it("même prep que suppressScreen sans changement de sig → rester sur scores", () => {
    const sig = sessionSignature(prepRow);
    const decision = shouldApplyWithScoresSuppress({
      effective: "consensus-prep",
      suppressScreen: "consensus-prep",
      suppressSig: sig,
      cachedRow: prepRow,
    });
    assert.equal(decision.allow, false);
    assert.equal(decision.reason, "scores_suppress_blocks_force_follow");
  });

  it("compatible(game-select, prep) est true — détourne isSessionAdvancedFromSuppress si sig absente", () => {
    assert.equal(isCompatibleSessionScreen("game-select", "consensus-prep"), true);
    assert.equal(
      isSessionAdvancedFromSuppress("consensus-prep", {
        suppressScreen: "game-select",
        suppressSig: "",
        cachedRow: prepRow,
      }),
      false
    );
  });
});
