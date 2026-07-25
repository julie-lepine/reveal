/**
 * ARCH-04 — bandeau reprise prep (asymétrie UI) :
 * - auto-route même prep reste bloquée (suppress volontaire) ;
 * - bandeau éligible pour destination getResumableSessionScreen (prep|play) ;
 * - rejoin intentionnel = clear suppress puis follow.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const MENU_SCREENS = new Set(["home", "lobby", "game-select", "settings"]);
const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);
/** Miroir GAME_SETUP_SCREENS (gameSync) — source de vérité prep. */
const GAME_SETUP = new Set([
  "traitre-prep",
  "hottake-prep",
  "speedvote-prep",
  "trivia-prep",
  "truthmeter-prep",
  "consensus-prep",
  "dilemma-prep",
  "playlistguess-prep",
  "clutch-prep",
  "wronganswer-prep",
  "guesslie-menu",
  "guesslie-setup",
  "guesslie-wait",
  "tiernight-select",
  "tiernight-create",
]);

function isOnGameSetupScreen(screen) {
  return GAME_SETUP.has(screen);
}

function isSessionInProgressPlay(screen) {
  if (!screen || MENU_SCREENS.has(screen) || POST_GAME_SCREENS.has(screen)) return false;
  if (isOnGameSetupScreen(screen)) return false;
  return true;
}

/** Miroir isGameSelectResumeBannerScreen — gate final getResumableSessionScreen. */
function isGameSelectResumeBannerScreen(screen) {
  if (!screen) return false;
  return isOnGameSetupScreen(screen) || isSessionInProgressPlay(screen);
}

function shouldShowGameSelectResumeBanner(screen, { syncActive = true, isHost = false } = {}) {
  return isGameSelectResumeBannerScreen(screen) && syncActive && !isHost;
}

/**
 * Miroir simplifié getResumableSessionScreen après normalisation effectiveScreen.
 * Les écrans non reprenables (post-game, menu, null) → null.
 */
function getResumableSessionScreen(effectiveScreen, { syncActive = true } = {}) {
  if (!syncActive || !effectiveScreen) return null;
  if (POST_GAME_SCREENS.has(effectiveScreen)) return null;
  if (effectiveScreen === "game-select") return null;
  if (isOnGameSetupScreen(effectiveScreen) || isSessionInProgressPlay(effectiveScreen)) {
    return effectiveScreen;
  }
  return null;
}

function isSuppressedGameReturn(targetScreen, { suppressActive, suppressScreen }) {
  if (!suppressActive || !suppressScreen || !targetScreen) return false;
  return targetScreen === suppressScreen;
}

function decideRoute({
  current,
  targetScreen,
  suppressScreen = null,
  suppressActive = false,
  suppressCleared = false,
}) {
  if (!targetScreen) return { allowed: false, reason: "no_screen" };
  if (current === targetScreen) return { allowed: false, reason: "already_on_target" };

  const active = suppressActive && !suppressCleared;
  const onVoluntaryExitHub =
    current === "game-select" ||
    current === "home" ||
    current === "lobby" ||
    current === "settings";
  if (
    onVoluntaryExitHub &&
    isSuppressedGameReturn(targetScreen, { suppressActive: active, suppressScreen })
  ) {
    return { allowed: false, reason: "voluntary_exit_suppress_hub" };
  }

  if (isOnGameSetupScreen(targetScreen) || isSessionInProgressPlay(targetScreen)) {
    return { allowed: true, reason: "guest_must_follow" };
  }
  return { allowed: false, reason: "no_route" };
}

/** Contrat rejoinGameResumeTarget : clear suppress puis route. */
function decideIntentionalRejoin({ current, targetScreen, suppressScreen }) {
  return decideRoute({
    current,
    targetScreen,
    suppressScreen,
    suppressActive: true,
    suppressCleared: true,
  });
}

describe("ARCH-04 suppress auto-route inchangé", () => {
  it("sortie volontaire prep : pas d'auto-route vers la même prep", () => {
    const d = decideRoute({
      current: "game-select",
      targetScreen: "hottake-prep",
      suppressScreen: "hottake-prep",
      suppressActive: true,
    });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "voluntary_exit_suppress_hub");
  });

  it("Rejoindre : clear suppress → retour prep distante autorisé", () => {
    const d = decideIntentionalRejoin({
      current: "game-select",
      targetScreen: "hottake-prep",
      suppressScreen: "hottake-prep",
    });
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "guest_must_follow");
  });
});

describe("ARCH-04 éligibilité bandeau", () => {
  it("invité + prep distante reprenable → bandeau visible", () => {
    const resume = getResumableSessionScreen("hottake-prep");
    assert.equal(resume, "hottake-prep");
    assert.equal(
      shouldShowGameSelectResumeBanner(resume, { syncActive: true, isHost: false }),
      true
    );
  });

  it("hôte → bandeau absent", () => {
    assert.equal(
      shouldShowGameSelectResumeBanner("hottake-prep", { syncActive: true, isHost: true }),
      false
    );
  });

  it("sans sync active → bandeau absent", () => {
    assert.equal(
      shouldShowGameSelectResumeBanner("hottake-prep", { syncActive: false, isHost: false }),
      false
    );
    assert.equal(getResumableSessionScreen("hottake-prep", { syncActive: false }), null);
  });

  it("écran non reprenable (post-game / hub) → pas de destination ni bandeau", () => {
    assert.equal(getResumableSessionScreen("results"), null);
    assert.equal(getResumableSessionScreen("game-select"), null);
    assert.equal(getResumableSessionScreen(null), null);
    assert.equal(isGameSelectResumeBannerScreen("results"), false);
    assert.equal(shouldShowGameSelectResumeBanner(null, { syncActive: true, isHost: false }), false);
  });

  it("régression play : bandeau toujours éligible", () => {
    const resume = getResumableSessionScreen("hottake");
    assert.equal(resume, "hottake");
    assert.equal(
      shouldShowGameSelectResumeBanner(resume, { syncActive: true, isHost: false }),
      true
    );
  });

  it("changement de jeu hôte : destination bandeau suit la nouvelle session", () => {
    let resume = getResumableSessionScreen("hottake-prep");
    assert.equal(resume, "hottake-prep");
    resume = getResumableSessionScreen("traitre-prep");
    assert.equal(resume, "traitre-prep");
    assert.equal(
      shouldShowGameSelectResumeBanner(resume, { syncActive: true, isHost: false }),
      true
    );
  });

  it("passage prep → play : nouvelle destination play (pas d'ancienne cible prep)", () => {
    let resume = getResumableSessionScreen("hottake-prep");
    assert.equal(resume, "hottake-prep");
    resume = getResumableSessionScreen("hottake");
    assert.equal(resume, "hottake");
    assert.equal(isOnGameSetupScreen(resume), false);
    assert.equal(isSessionInProgressPlay(resume), true);
  });

  it("fin de session : disparition destination / bandeau", () => {
    assert.equal(getResumableSessionScreen("results"), null);
    assert.equal(
      shouldShowGameSelectResumeBanner(getResumableSessionScreen("results"), {
        syncActive: true,
        isHost: false,
      }),
      false
    );
  });

  it("Guess Lie : session effective guesslie-menu est reprenable (pas un écran local orphelin)", () => {
    const resume = getResumableSessionScreen("guesslie-menu");
    assert.equal(resume, "guesslie-menu");
    assert.equal(shouldShowGameSelectResumeBanner(resume, { syncActive: true, isHost: false }), true);
  });
});
