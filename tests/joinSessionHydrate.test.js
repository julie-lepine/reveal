import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JOIN_SESSION_RESTORE_DELAYS_MS,
  SUBSCRIBED_ROUTE_DEBOUNCE_MS,
  planLobbyJoinSyncOrder,
  shouldRouteAfterRealtimeSubscribed,
  createDebouncedCallback,
} from "../js/core/joinSessionHydrate.js";

describe("T-01 / T-02 join session hydrate", () => {
  it("ordre critique : restore avant startMultiplayerSync", () => {
    assert.deepEqual(planLobbyJoinSyncOrder(), [
      "restoreActiveGameSession",
      "startMultiplayerSync",
    ]);
  });

  it("restore : pas de tentative à 0 ms ; délais croissants", () => {
    assert.ok(JOIN_SESSION_RESTORE_DELAYS_MS.length >= 3);
    assert.equal(
      JOIN_SESSION_RESTORE_DELAYS_MS.some((ms) => ms === 0),
      false,
      "évite le fetch immédiat à 0 ms (T-01)"
    );
    for (let i = 1; i < JOIN_SESSION_RESTORE_DELAYS_MS.length; i++) {
      assert.ok(
        JOIN_SESSION_RESTORE_DELAYS_MS[i] > JOIN_SESSION_RESTORE_DELAYS_MS[i - 1]
      );
    }
  });

  it("SUBSCRIBED pendant hydrate join → ne route pas", () => {
    assert.equal(
      shouldRouteAfterRealtimeSubscribed({ joinSessionHydrating: true }),
      false
    );
  });

  it("SUBSCRIBED après hydrate → route autorisée", () => {
    assert.equal(
      shouldRouteAfterRealtimeSubscribed({ joinSessionHydrating: false }),
      true
    );
  });

  it("debounce SUBSCRIBED coalesce ; cancel empêche le callback", async () => {
    const calls = [];
    const debounced = createDebouncedCallback((row) => calls.push(row), 40);
    debounced.schedule({ id: 1 });
    debounced.schedule({ id: 2 });
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(calls, [{ id: 2 }]);

    calls.length = 0;
    debounced.schedule({ id: 3 });
    debounced.cancel();
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(calls, []);
  });

  it("debounce delay SUBSCRIBED est borné (pas sur INSERT/UPDATE)", () => {
    assert.ok(SUBSCRIBED_ROUTE_DEBOUNCE_MS >= 200);
    assert.ok(SUBSCRIBED_ROUTE_DEBOUNCE_MS <= 500);
  });
});
