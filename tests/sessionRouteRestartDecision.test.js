/**
 * Simulation décisionnelle Event A (lobby) vs Event B (game_sessions prep)
 * pour le scénario : invité sur results, hôte clique Recommencer.
 *
 * Ne charge pas gameSync.js (dépendances DOM/Supabase) : miroir des gardes critiques
 * pour départager les hypothèses sans patcher getEffectiveSessionScreen.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

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

const SESSION_GAME_ID_TO_TILE = {
  consensus: "consensus-prep",
  hottake: "hottake-prep",
};

function sessionSignature(row) {
  if (!row) return "";
  return `${row.screen}|${JSON.stringify(row.state || {})}`;
}

function isOnGameSetupScreen(screen) {
  return GAME_SETUP_SCREENS.has(screen);
}

function isActiveGameSessionScreen(screen) {
  if (!screen || MENU_SCREENS.has(screen)) return false;
  if (POST_GAME_SCREENS.has(screen)) return false;
  return true;
}

function resolveActivePlayScreen(st) {
  if (st?.consensus?.lobbyStarted) return "consensus";
  if (st?.hotTake?.lobbyStarted) return "hottake";
  return null;
}

/**
 * Miroir de getEffectiveSessionScreen (branche post-partie + prep) — état actuel du code.
 * Le short-circuit local post-partie ignore lobbyPrep (pas encore patché).
 */
function getEffectiveSessionScreen(row, { local, suppressed = false, lobbyGameId = null }) {
  if (!row) return null;
  const declared = row.screen || null;
  const st = row.state || {};

  if (declared && POST_GAME_SCREENS.has(declared)) {
    const skippedActivePlay = resolveActivePlayScreen(st);
    const lobbyPrep =
      lobbyGameId && lobbyGameId !== "menu"
        ? SESSION_GAME_ID_TO_TILE[lobbyGameId] || null
        : null;
    if (POST_GAME_SCREENS.has(local) || suppressed) {
      // Comportement ACTUEL : retourne declared, ignore lobbyPrep
      return { effective: declared, skippedActivePlay, lobbyPrep, branch: "post_game_local_short_circuit" };
    }
    if (lobbyPrep) return { effective: lobbyPrep, skippedActivePlay, lobbyPrep, branch: "lobby_prep_infer" };
    return { effective: declared, skippedActivePlay, lobbyPrep, branch: "post_game_declared" };
  }

  const activePlay = resolveActivePlayScreen(st);
  if (activePlay) return { effective: activePlay, branch: "active_play" };
  if (declared && GAME_SETUP_SCREENS.has(declared)) {
    return { effective: declared, branch: "declared_prep" };
  }
  return { effective: declared, branch: "declared_fallback" };
}

function shouldForceGuestFollowSession(screen) {
  return isOnGameSetupScreen(screen) || isActiveGameSessionScreen(screen);
}

function isBrowsingScoresWithRouteSuppress(local, suppressed) {
  return POST_GAME_SCREENS.has(local) && suppressed;
}

function isSessionAdvancedFromSuppress(targetScreen, suppressScreen, suppressSig, currentSig) {
  void suppressSig;
  void currentSig;
  if (!suppressScreen || !targetScreen) return false;
  if (targetScreen === suppressScreen) return false;
  return true;
}

function shouldApplySessionRoute({
  effective,
  local,
  suppressed = false,
  suppressScreen = null,
  suppressSig = "",
  currentSig = "",
}) {
  if (!effective) return { allow: false, reason: "no_effective_screen" };
  if (effective === local) return { allow: false, reason: "already_on_target_screen" };

  if (isBrowsingScoresWithRouteSuppress(local, suppressed)) {
    if (isSessionAdvancedFromSuppress(effective, suppressScreen, suppressSig, currentSig)) {
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

  if (POST_GAME_SCREENS.has(effective) || effective === "game-select" || effective === "lobby") {
    return { allow: false, reason: "session_hub_screen_guest_free" };
  }

  if (shouldForceGuestFollowSession(effective)) {
    return { allow: true, reason: "force_follow_prep_or_play" };
  }
  return { allow: true, reason: "allow" };
}

function routeToActiveGameIfNeeded({ effective, local, suppressed = false, force = false }) {
  if (!effective) return { routed: false, reason: "no_effective_screen" };
  const isEveningHub = effective === "game-select";
  if (!isEveningHub && !isActiveGameSessionScreen(effective) && !isOnGameSetupScreen(effective)) {
    return { routed: false, reason: "effective_screen_post_game_only" };
  }
  if (local === effective) return { routed: true, reason: "already_on_target_screen" };
  if (!force && isBrowsingScoresWithRouteSuppress(local, suppressed)) {
    return { routed: false, reason: "scores_suppress_blocks" };
  }
  return { routed: true, reason: "navigate" };
}

describe("restart decision: Event A (lobby) vs Event B (prep session)", () => {
  const resultsRow = {
    game_id: "menu",
    screen: "results",
    updated_at: "2026-07-22T10:00:00.000Z",
    state: {
      consensus: { lobbyStarted: false, phase: "final", podiumApplied: true },
    },
  };

  const prepRow = {
    game_id: "consensus",
    screen: "consensus-prep",
    updated_at: "2026-07-22T10:00:01.500Z",
    state: {
      consensus: {
        lobbyStarted: false,
        phase: null,
        ready: {},
        roundCount: 5,
      },
    },
  };

  it("Event A : lobby playing + session encore results → effective reste results (bloqué)", () => {
    const eff = getEffectiveSessionScreen(resultsRow, {
      local: "results",
      lobbyGameId: "consensus",
    });
    assert.equal(eff.effective, "results");
    assert.equal(eff.branch, "post_game_local_short_circuit");
    assert.equal(eff.lobbyPrep, "consensus-prep");

    const apply = shouldApplySessionRoute({
      effective: eff.effective,
      local: "results",
    });
    assert.equal(apply.allow, false);
    assert.equal(apply.reason, "already_on_target_screen");

    const route = routeToActiveGameIfNeeded({
      effective: eff.effective,
      local: "results",
    });
    assert.equal(route.routed, false);
    assert.equal(route.reason, "effective_screen_post_game_only");
  });

  it("Event B : screen=consensus-prep → effective=prep et navigation autorisée (sans suppress)", () => {
    const eff = getEffectiveSessionScreen(prepRow, {
      local: "results",
      lobbyGameId: "consensus",
    });
    assert.equal(eff.effective, "consensus-prep");
    assert.equal(eff.branch, "declared_prep");

    const apply = shouldApplySessionRoute({
      effective: eff.effective,
      local: "results",
    });
    assert.equal(apply.allow, true);
    assert.equal(apply.reason, "force_follow_prep_or_play");

    const route = routeToActiveGameIfNeeded({
      effective: eff.effective,
      local: "results",
    });
    assert.equal(route.routed, true);
    assert.equal(route.reason, "navigate");
  });

  it("Event B + suppress scores : target prep ≠ suppressScreen → advanced, allow", () => {
    const suppressSig = sessionSignature(resultsRow);
    const currentSig = sessionSignature(resultsRow);
    const apply = shouldApplySessionRoute({
      effective: "consensus-prep",
      local: "results",
      suppressed: true,
      suppressScreen: "results",
      suppressSig,
      currentSig,
    });
    assert.equal(apply.allow, true);
    assert.equal(apply.reason, "scores_suppress_bypass_session_advanced");
  });

  it("signatures results→prep sont distinctes (hyp. 6)", () => {
    assert.notEqual(sessionSignature(resultsRow), sessionSignature(prepRow));
  });

  it("chronologie attendue si Event B est reçu et appliqué", () => {
    const timeline = [];

    // Event A
    const a = getEffectiveSessionScreen(resultsRow, {
      local: "results",
      lobbyGameId: "consensus",
    });
    timeline.push({
      event: "A_lobby",
      sessionScreen: resultsRow.screen,
      lobbyGameId: "consensus",
      effective: a.effective,
      route: routeToActiveGameIfNeeded({ effective: a.effective, local: "results" }),
    });

    // Event B
    const b = getEffectiveSessionScreen(prepRow, {
      local: "results",
      lobbyGameId: "consensus",
    });
    const applyB = shouldApplySessionRoute({
      effective: b.effective,
      local: "results",
    });
    const routeB = routeToActiveGameIfNeeded({
      effective: b.effective,
      local: "results",
    });
    timeline.push({
      event: "B_game_sessions",
      sessionScreen: prepRow.screen,
      gameId: prepRow.game_id,
      effective: b.effective,
      apply: applyB,
      route: routeB,
    });

    assert.equal(timeline[0].route.routed, false);
    assert.equal(timeline[1].route.routed, true);
    assert.equal(timeline[1].apply.allow, true);

    console.info("[SESSION-ROUTE][SIM]", JSON.stringify(timeline, null, 2));
  });
});
