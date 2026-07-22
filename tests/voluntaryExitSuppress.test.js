/**
 * SYN-13b / suppress sortie volontaire :
 * - hub + suppress prioritaire sur guest_must_follow ;
 * - suppress lié à la famille d'écran, pas au blob state.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const MENU_SCREENS = new Set(["home", "lobby", "game-select", "settings"]);
const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);
const GAME_SETUP = new Set([
  "traitre-prep",
  "hottake-prep",
  "consensus-prep",
  "guesslie-menu",
  "guesslie-setup",
  "guesslie-wait",
]);
const GUESS_LIE_PREP_SCREENS = new Set(["guesslie-menu", "guesslie-setup", "guesslie-wait"]);

function sessionSignature(row) {
  if (!row) return "";
  return `${row.screen || ""}|${JSON.stringify(row.state || {})}`;
}

function isOnGameSetupScreen(screen) {
  return GAME_SETUP.has(screen);
}

function isActiveGameSessionScreen(screen) {
  if (!screen || MENU_SCREENS.has(screen)) return false;
  if (POST_GAME_SCREENS.has(screen)) return false;
  return true;
}

function shouldForceGuestFollowSession(screen) {
  if (!screen) return false;
  return isOnGameSetupScreen(screen) || isActiveGameSessionScreen(screen);
}

/** Miroir partiel de isCompatibleSessionScreen (familles utiles au suppress). */
function isCompatibleSessionScreen(sessionScreen, localScreen) {
  if (sessionScreen === localScreen) return true;
  if (GUESS_LIE_PREP_SCREENS.has(sessionScreen) && GUESS_LIE_PREP_SCREENS.has(localScreen)) {
    return true;
  }
  if (sessionScreen === "game-select") {
    if (isOnGameSetupScreen(localScreen) || isActiveGameSessionScreen(localScreen)) {
      return true;
    }
  }
  return false;
}

/**
 * Miroir de isSuppressedGameReturn (gameSync) : famille d'écran, pas signature state.
 * suppressActive / suppressScreen / cachedRow simulent le module (pas d'import DOM).
 */
function isSuppressedGameReturn(targetScreen, { suppressActive, suppressScreen, cachedRow }) {
  if (!suppressActive || !suppressScreen || !targetScreen) return false;
  // Intentionnel : ne pas comparer sessionSignature(cachedRow) — les mutations
  // de state sur le même écran doivent conserver le suppress.
  void cachedRow;
  if (targetScreen === suppressScreen) return true;
  if (
    shouldForceGuestFollowSession(suppressScreen) &&
    shouldForceGuestFollowSession(targetScreen) &&
    isCompatibleSessionScreen(suppressScreen, targetScreen)
  ) {
    return true;
  }
  return false;
}

/**
 * Miroir de isSessionAdvancedFromSuppress (gameSync) après correctif famille d'écran.
 */
function isSessionAdvancedFromSuppress(
  targetScreen,
  { suppressScreen, suppressSig, cachedRow }
) {
  const forceFollow = shouldForceGuestFollowSession(targetScreen);
  const suppressFromHubOrPost =
    suppressScreen === "game-select" ||
    suppressScreen === "lobby" ||
    POST_GAME_SCREENS.has(suppressScreen);
  const sameScreen = Boolean(suppressScreen && targetScreen && targetScreen === suppressScreen);
  const compatible = Boolean(
    suppressScreen && targetScreen && isCompatibleSessionScreen(suppressScreen, targetScreen)
  );
  // cachedRow / suppressSig : plus de branche sig_changed ; suppressSig vide
  // sert encore au chemin hub/post (force_follow_from_hub_or_empty_sig).
  void sessionSignature(cachedRow);

  if (!targetScreen) return false;
  if (!suppressScreen) return forceFollow;
  if (sameScreen) return false;
  if (forceFollow && (!suppressSig || suppressFromHubOrPost)) return true;
  if (compatible) return false;
  if (forceFollow && shouldForceGuestFollowSession(suppressScreen)) return true;
  return true;
}

function guestMustFollowSession(targetScreen, currentScreen, { isHost = false, inLobby = true } = {}) {
  if (!targetScreen || isHost || !inLobby) return false;
  if (!shouldForceGuestFollowSession(targetScreen)) return false;
  if (currentScreen === targetScreen) return false;
  return true;
}

function decideRoute({
  current,
  targetScreen,
  suppressScreen = null,
  suppressActive = false,
  cachedRow = null,
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
    isSuppressedGameReturn(targetScreen, {
      suppressActive,
      suppressScreen,
      cachedRow,
    })
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
      cachedRow: { screen: "traitre", state: { traitre: { votes: {} } } },
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
      cachedRow: { screen: "hottake-prep", state: { hotTake: {} } },
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
    assert.equal(d.reason, "guest_must_follow");
    assert.equal(d.allowed, true);
  });
});

describe("suppress sortie volontaire : famille d'écran (pas state)", () => {
  const traitreBaseline = {
    screen: "traitre",
    state: { traitre: { lobbyStarted: true, votes: {}, phase: "vote" } },
  };
  const traitreAfterVotes = {
    screen: "traitre",
    state: {
      traitre: { lobbyStarted: true, votes: { Alice: "Bob" }, phase: "vote", timer: 42 },
    },
  };
  const guessLieMenu = {
    screen: "guesslie-menu",
    state: { guessLie: { submissions: {} } },
  };
  const guessLieMenuMutated = {
    screen: "guesslie-menu",
    state: { guessLie: { submissions: { u1: { text: "x" } }, tick: 3 } },
  };

  it("1. suppress actif + mutations state même jeu → suppression conservée", () => {
    assert.equal(
      isSuppressedGameReturn("traitre", {
        suppressActive: true,
        suppressScreen: "traitre",
        cachedRow: traitreAfterVotes,
      }),
      true
    );
    assert.equal(
      isSessionAdvancedFromSuppress("traitre", {
        suppressScreen: "traitre",
        suppressSig: sessionSignature(traitreBaseline),
        cachedRow: traitreAfterVotes,
      }),
      false,
      "même screen malgré sig différente → pas avancé"
    );

    assert.equal(
      isSuppressedGameReturn("guesslie-menu", {
        suppressActive: true,
        suppressScreen: "guesslie-menu",
        cachedRow: guessLieMenuMutated,
      }),
      true
    );
    assert.equal(
      isSessionAdvancedFromSuppress("guesslie-menu", {
        suppressScreen: "guesslie-menu",
        suppressSig: sessionSignature(guessLieMenu),
        cachedRow: guessLieMenuMutated,
      }),
      false
    );

    const hubDecision = decideRoute({
      current: "game-select",
      targetScreen: "traitre",
      suppressScreen: "traitre",
      suppressActive: true,
      cachedRow: traitreAfterVotes,
    });
    assert.equal(hubDecision.allowed, false);
    assert.equal(hubDecision.reason, "voluntary_exit_suppress_hub");
  });

  it("2. suppress actif + passage vers un autre jeu → suppression levée", () => {
    assert.equal(
      isSuppressedGameReturn("hottake", {
        suppressActive: true,
        suppressScreen: "traitre",
        cachedRow: { screen: "hottake", state: { hotTake: { lobbyStarted: true } } },
      }),
      false
    );
    assert.equal(
      isSessionAdvancedFromSuppress("hottake", {
        suppressScreen: "traitre",
        suppressSig: sessionSignature(traitreBaseline),
        cachedRow: { screen: "hottake", state: { hotTake: { lobbyStarted: true } } },
      }),
      true
    );
    assert.equal(
      isSessionAdvancedFromSuppress("trivia-prep", {
        suppressScreen: "guesslie-menu",
        suppressSig: sessionSignature(guessLieMenu),
        cachedRow: { screen: "trivia-prep", state: {} },
      }),
      true
    );

    const hubDecision = decideRoute({
      current: "game-select",
      targetScreen: "hottake-prep",
      suppressScreen: "traitre",
      suppressActive: true,
      cachedRow: { screen: "hottake-prep", state: {} },
    });
    assert.equal(hubDecision.allowed, true);
    assert.equal(hubDecision.reason, "guest_must_follow");
  });

  it("3. prep → jeu du même jeu : contrat existant = suppress levé (pas famille compatible)", () => {
    /**
     * isCompatibleSessionScreen ne couple pas traitre-prep ↔ traitre.
     * Donc isSuppressedGameReturn(prep→play) = false, et
     * isSessionAdvancedFromSuppress = true (force_follow_from_other_active).
     * L'invité suit le démarrage de la partie qu'il avait quittée en prep.
     */
    assert.equal(isCompatibleSessionScreen("traitre-prep", "traitre"), false);
    assert.equal(
      isSuppressedGameReturn("traitre", {
        suppressActive: true,
        suppressScreen: "traitre-prep",
        cachedRow: { screen: "traitre", state: { traitre: { lobbyStarted: true } } },
      }),
      false
    );
    assert.equal(
      isSessionAdvancedFromSuppress("traitre", {
        suppressScreen: "traitre-prep",
        suppressSig: sessionSignature({
          screen: "traitre-prep",
          state: { traitre: { lobbyStarted: false } },
        }),
        cachedRow: { screen: "traitre", state: { traitre: { lobbyStarted: true } } },
      }),
      true
    );
  });

  it("Guess Lie : transition menu→setup reste dans la famille (suppress conservé)", () => {
    assert.equal(
      isSuppressedGameReturn("guesslie-setup", {
        suppressActive: true,
        suppressScreen: "guesslie-menu",
        cachedRow: { screen: "guesslie-setup", state: {} },
      }),
      true
    );
    assert.equal(
      isSessionAdvancedFromSuppress("guesslie-setup", {
        suppressScreen: "guesslie-menu",
        suppressSig: sessionSignature(guessLieMenu),
        cachedRow: { screen: "guesslie-setup", state: { guessLie: { tick: 1 } } },
      }),
      false
    );
  });
});
