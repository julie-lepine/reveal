/**
 * Retry de navigation après un premier refus (suppress) alors que la sig session
 * n'a pas changé — miroir de la logique applyRemoteSession sig_unchanged + forceFollow.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);
const GAME_SETUP_SCREENS = new Set(["hottake-prep", "consensus-prep"]);

function sessionSignature(row) {
  if (!row) return "";
  return `${row.screen}|${JSON.stringify(row.state || {})}`;
}

function shouldForceGuestFollowSession(screen) {
  return GAME_SETUP_SCREENS.has(screen) || (screen && !POST_GAME_SCREENS.has(screen) && screen !== "game-select" && screen !== "home" && screen !== "lobby");
}

/**
 * Après sig_unchanged early exit : retenter si écran local ≠ cible force-follow.
 */
function shouldRetryRouteAfterSigUnchanged({
  currentScreen,
  effective,
  lastSessionSig,
  row,
}) {
  const sig = sessionSignature(row);
  const sigUnchanged = sig === lastSessionSig;
  if (!sigUnchanged) return { retry: true, reason: "sig_changed_normal_path" };
  if (!effective) return { retry: false, reason: "no_effective" };
  if (currentScreen === effective) return { retry: false, reason: "already_on_target" };
  if (!shouldForceGuestFollowSession(effective)) {
    return { retry: false, reason: "not_force_follow_target" };
  }
  return { retry: true, reason: "local_mismatch_force_follow_retry" };
}

describe("sig unchanged local screen mismatch retry", () => {
  const prepRow = {
    screen: "hottake-prep",
    state: { hotTake: { lobbyStarted: false, ready: {} } },
  };
  const sig = sessionSignature(prepRow);

  it("première observation puis tick identique, local encore results → retry", () => {
    const first = shouldRetryRouteAfterSigUnchanged({
      currentScreen: "results",
      effective: "hottake-prep",
      lastSessionSig: "",
      row: prepRow,
    });
    assert.equal(first.retry, true);
    assert.equal(first.reason, "sig_changed_normal_path");

    const second = shouldRetryRouteAfterSigUnchanged({
      currentScreen: "results",
      effective: "hottake-prep",
      lastSessionSig: sig,
      row: prepRow,
    });
    assert.equal(second.retry, true);
    assert.equal(second.reason, "local_mismatch_force_follow_retry");
  });

  it("déjà sur hottake-prep + même sig → pas de retry", () => {
    const decision = shouldRetryRouteAfterSigUnchanged({
      currentScreen: "hottake-prep",
      effective: "hottake-prep",
      lastSessionSig: sig,
      row: prepRow,
    });
    assert.equal(decision.retry, false);
    assert.equal(decision.reason, "already_on_target");
  });

  it("même sig, cible post-partie → pas de force-follow retry", () => {
    const resultsRow = { screen: "results", state: { scores: { A: 1 } } };
    const decision = shouldRetryRouteAfterSigUnchanged({
      currentScreen: "results",
      effective: "results",
      lastSessionSig: sessionSignature(resultsRow),
      row: resultsRow,
    });
    assert.equal(decision.retry, false);
  });
});
