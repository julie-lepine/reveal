/**
 * Invariant guestMustFollow : invité dans le lobby + prep/play + écran local ≠ cible.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);
const MENU_SCREENS = new Set(["home", "lobby", "game-select", "settings"]);
const GAME_SETUP_SCREENS = new Set(["hottake-prep", "consensus-prep"]);

function shouldForceGuestFollowSession(screen) {
  if (!screen) return false;
  if (GAME_SETUP_SCREENS.has(screen)) return true;
  if (MENU_SCREENS.has(screen) || POST_GAME_SCREENS.has(screen)) return false;
  return true;
}

function guestMustFollowSession({
  targetScreen,
  currentScreen,
  isHost = false,
  inLobby = true,
  lobbyId = "lobby-1",
}) {
  if (!targetScreen) return false;
  if (isHost) return false;
  if (!inLobby || !lobbyId) return false;
  if (!shouldForceGuestFollowSession(targetScreen)) return false;
  if (currentScreen === targetScreen) return false;
  return true;
}

function decideGuestRoute({
  targetScreen,
  currentScreen,
  isHost = false,
  inLobby = true,
  lobbyId = "lobby-1",
  browsingScoresSuppress = false,
  sessionAdvancedFromSuppress = false,
}) {
  if (currentScreen === targetScreen) {
    return { allowed: false, reason: "already_on_target_screen" };
  }
  const mustFollow = guestMustFollowSession({
    targetScreen,
    currentScreen,
    isHost,
    inLobby,
    lobbyId,
  });
  if (mustFollow) {
    if (browsingScoresSuppress && !sessionAdvancedFromSuppress) {
      return { allowed: false, reason: "scores_suppress_blocks_must_follow" };
    }
    return { allowed: true, reason: "guest_must_follow" };
  }
  return { allowed: false, reason: "no_must_follow" };
}

describe("guestMustFollow invariant (generic screens)", () => {
  it("results → hottake-prep : navigate", () => {
    const d = decideGuestRoute({
      currentScreen: "results",
      targetScreen: "hottake-prep",
      browsingScoresSuppress: true,
      sessionAdvancedFromSuppress: true,
    });
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "guest_must_follow");
  });

  it("leaderboard → hottake-prep : navigate", () => {
    const d = decideGuestRoute({
      currentScreen: "leaderboard",
      targetScreen: "hottake-prep",
      browsingScoresSuppress: true,
      sessionAdvancedFromSuppress: true,
    });
    assert.equal(d.allowed, true);
  });

  it("home avec lobby actif → hottake-prep : navigate", () => {
    const d = decideGuestRoute({
      currentScreen: "home",
      targetScreen: "hottake-prep",
      inLobby: true,
    });
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "guest_must_follow");
  });

  it("game-select → hottake-prep : navigate", () => {
    const d = decideGuestRoute({
      currentScreen: "game-select",
      targetScreen: "hottake-prep",
    });
    assert.equal(d.allowed, true);
  });

  it("home hors lobby → ne pas naviguer", () => {
    const d = decideGuestRoute({
      currentScreen: "home",
      targetScreen: "hottake-prep",
      inLobby: false,
      lobbyId: null,
    });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "no_must_follow");
  });

  it("même cible que l’écran courant → ne pas reboucler", () => {
    const d = decideGuestRoute({
      currentScreen: "hottake-prep",
      targetScreen: "hottake-prep",
    });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "already_on_target_screen");
  });
});
