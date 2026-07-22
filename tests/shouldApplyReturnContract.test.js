/**
 * Contrat shouldApplySessionRoute → handleSessionRoute : booléen allowed.
 * guest_must_follow doit propager allowed=true (pas undefined via log helper).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Miroir du bug : routeLog renvoyait logSessionRouteDecision() (undefined).
 */
function logSessionRouteDecision(_source, _row, _allowed, _reason) {
  // side-effect only — no return
}

function routeLogBroken(allowed, reason) {
  logSessionRouteDecision("test", null, allowed, reason);
  return logSessionRouteDecision("test", null, allowed, reason);
}

function routeLogFixed(allowed, reason) {
  logSessionRouteDecision("test", null, allowed, reason);
  return allowed;
}

describe("shouldApply → handleSessionRoute contract", () => {
  it("routeLog broken : guest_must_follow → undefined (falsy) — le bug observé", () => {
    const decision = routeLogBroken(true, "guest_must_follow");
    assert.equal(decision, undefined);
    assert.equal(typeof decision, "undefined");
    // handleSessionRoute : if (!decision) → bloque malgré reason guest_must_follow
    assert.equal(!decision, true);
  });

  it("routeLog fixed : guest_must_follow → true", () => {
    const decision = routeLogFixed(true, "guest_must_follow");
    assert.equal(decision, true);
    assert.equal(typeof decision, "boolean");
    assert.equal(!decision, false);
  });

  it("routeLog fixed : refus → false", () => {
    const decision = routeLogFixed(false, "already_on_target_screen");
    assert.equal(decision, false);
  });
});
