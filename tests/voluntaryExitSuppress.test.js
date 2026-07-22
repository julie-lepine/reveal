/**
 * SYN-13b : sortie volontaire hub prioritaire sur guest_must_follow / force_follow.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const MENU_SCREENS = new Set(["home", "lobby", "game-select", "settings"]);
const GAME_SETUP = new Set(["traitre-prep", "hottake-prep", "consensus-prep"]);

function shouldForceGuestFollowSession(screen) {
  if (!screen) return false;
  if (GAME_SETUP.has(screen)) return true;
  if (MENU_SCREENS.has(screen) || screen === "results" || screen === "leaderboard") return false;
  return true; // play screens
}

function guestMustFollowSession(targetScreen, currentScreen, { isHost = false, inLobby = true } = {}) {
  if (!targetScreen || isHost || !inLobby) return false;
  if (!shouldForceGuestFollowSession(targetScreen)) return false;
  if (currentScreen === targetScreen) return false;
  return true;
}

function isSuppressedGameReturn(targetScreen, suppressScreen, suppressActive) {
  if (!suppressActive || !suppressScreen || !targetScreen) return false;
  return targetScreen === suppressScreen;
}

function decideRoute({
  current,
  targetScreen,
  suppressScreen = null,
  suppressActive = false,
  isHost = false,
}) {
  if (!targetScreen) return { allowed: false, reason: "no_screen" };
  if (current === targetScreen) return { allowed: false, reason: "already_on_target" };

  const onVoluntaryExitHub =
    current === "game-select" ||
    current === "home" ||
    current === "lobby" ||
    current === "settings";
  if (
    onVoluntaryExitHub &&
    isSuppressedGameReturn(targetScreen, suppressScreen, suppressActive)
  ) {
    return { allowed: false, reason: "voluntary_exit_suppress_hub" };
  }

  const mustFollow = guestMustFollowSession(targetScreen, current, { isHost });
  if (mustFollow) {
    return { allowed: true, reason: "guest_must_follow" };
  }

  if (shouldForceGuestFollowSession(targetScreen) && !isHost) {
    return { allowed: true, reason: "force_follow_prep_or_play" };
  }

  return { allowed: false, reason: "no_route" };
}

describe("SYN-13b voluntary exit suppress vs mustFollow", () => {
  it("invité sur game-select + suppress traitre + session traitre → refuse", () => {
    const d = decideRoute({
      current: "game-select",
      targetScreen: "traitre",
      suppressScreen: "traitre",
      suppressActive: true,
    });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "voluntary_exit_suppress_hub");
  });

  it("invité sur game-select + suppress traitre + nouvelle prep autre jeu → autorise", () => {
    const d = decideRoute({
      current: "game-select",
      targetScreen: "hottake-prep",
      suppressScreen: "traitre",
      suppressActive: true,
    });
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "guest_must_follow");
  });

  it("sans suppress : guest_must_follow reste actif", () => {
    const d = decideRoute({
      current: "game-select",
      targetScreen: "traitre",
      suppressActive: false,
    });
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "guest_must_follow");
  });

  it("sur results (pas hub sortie volontaire) : suppress jeu n’utilise pas la branche hub", () => {
    const d = decideRoute({
      current: "results",
      targetScreen: "traitre",
      suppressScreen: "traitre",
      suppressActive: true,
    });
    // Pas de branche voluntary_exit_suppress_hub ; mustFollow s’applique
    assert.equal(d.reason, "guest_must_follow");
    assert.equal(d.allowed, true);
  });
});
