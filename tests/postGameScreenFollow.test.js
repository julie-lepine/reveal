import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Extrait de routeToActiveGameIfNeeded (gameSync.js) : une session post-partie seule
 * ne doit pas déclencher de navigation depuis results/leaderboard.
 */
const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);
const MENU_SCREENS = new Set(["home", "lobby", "game-select", "settings"]);
const GAME_SETUP_SCREENS = new Set([
  "traitre-prep",
  "hottake-prep",
  "speedvote-prep",
  "clutch-prep",
  "wronganswer-prep",
  "playlistguess-prep",
  "trivia-prep",
  "truthmeter-prep",
  "consensus-prep",
  "dilemma-prep",
  "guesslie-menu",
  "tiernight-select",
]);

function isOnGameSetupScreen(screen) {
  return GAME_SETUP_SCREENS.has(screen);
}

function isSessionInProgressPlay(screen) {
  if (!screen || MENU_SCREENS.has(screen) || POST_GAME_SCREENS.has(screen)) return false;
  if (isOnGameSetupScreen(screen)) return false;
  return true;
}

function shouldRouteFromPostGameListener(effectiveScreen) {
  if (!effectiveScreen) return false;
  const isEveningHub = effectiveScreen === "game-select";
  if (
    !isEveningHub &&
    !isSessionInProgressPlay(effectiveScreen) &&
    !isOnGameSetupScreen(effectiveScreen)
  ) {
    return false;
  }
  return true;
}

describe("post-game screen session follow", () => {
  it("ne route pas sur une session encore en post-partie (scores seulement)", () => {
    assert.equal(shouldRouteFromPostGameListener("results"), false);
    assert.equal(shouldRouteFromPostGameListener("leaderboard"), false);
  });

  it("route quand l'hôte ouvre une prep ou une partie", () => {
    assert.equal(shouldRouteFromPostGameListener("hottake-prep"), true);
    assert.equal(shouldRouteFromPostGameListener("hottake"), true);
    assert.equal(shouldRouteFromPostGameListener("consensus-prep"), true);
  });
});
