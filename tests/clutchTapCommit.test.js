import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  freezeClutchTap,
  mergeClutchTapsFrozen,
  computeClutchTapApply,
  preferInFlightClutchTap,
  resolveClutchTapCommitFailureUi,
  simulateClutchTapCommitCycle,
} from "../js/core/clutchTapCommit.js";

describe("SYN-26 clutch tap freeze / merge", () => {
  it("1. timestamp capturé au clic → commit différé → même timestamp final", () => {
    const clicked = { ms: 4123, at: 1_700_000_111_000 };
    const applied = computeClutchTapApply({ taps: {} }, "Alice", clicked);
    const committed = freezeClutchTap(applied.tap);
    assert.equal(committed.ms, 4123);
    assert.equal(committed.at, 1_700_000_111_000);
    assert.deepEqual(committed, clicked);
  });

  it("2. tap optimiste pendant session distante stale → valeur optimiste conservée", () => {
    const optimistic = { ms: 2500, at: 100 };
    const sessionStale = { Bob: { ms: 3000, at: 90 } };
    const merged = preferInFlightClutchTap(
      sessionStale,
      { Alice: optimistic },
      "Alice",
      true
    );
    assert.deepEqual(merged.Alice, optimistic);
    assert.deepEqual(merged.Bob, { ms: 3000, at: 90 });
  });

  it("3. deux joueurs, résolutions réseau dans l’ordre inverse → valeurs originales intactes", () => {
    const alice = { ms: 5000, at: 1000 };
    const bob = { ms: 4800, at: 2000 };
    let server = mergeClutchTapsFrozen({}, { Bob: bob });
    server = mergeClutchTapsFrozen(server, {
      Alice: alice,
      Bob: { ms: 9999, at: 9999 },
    });
    assert.deepEqual(server.Alice, alice);
    assert.deepEqual(server.Bob, bob);
  });

  it("4. double clic pendant commit → un seul tap et timestamp du premier clic", () => {
    const first = { ms: 1500, at: 10 };
    const second = { ms: 1600, at: 11 };
    const once = computeClutchTapApply({ taps: {} }, "Alice", first);
    const twice = computeClutchTapApply({ taps: once.nextTaps }, "Alice", second);
    assert.equal(twice.alreadyTapped, true);
    assert.deepEqual(twice.tap, first);
    assert.equal(twice.nextTaps.Alice.ms, 1500);
    assert.equal(twice.nextTaps.Alice.at, 10);
  });

  it("5. rollback du premier tap échoué → deuxième clic utilise un nouveau timestamp", () => {
    const out = simulateClutchTapCommitCycle({
      session: { taps: { Bob: { ms: 900, at: 1 } } },
      localName: "Alice",
      firstTap: { ms: 1100, at: 2 },
      secondTap: { ms: 1300, at: 3 },
      commitFails: true,
    });
    assert.equal(out.ok, true);
    assert.deepEqual(out.sent[0], { ms: 1300, at: 3 });
    assert.equal(out.taps.Alice.ms, 1300);
    assert.equal(out.taps.Alice.at, 3);
    assert.equal(out.taps.Bob.ms, 900);
  });

  it("6. clôture après tous les commits → aucun recalcul au reveal", () => {
    const alice = { ms: 4123, at: 100 };
    const bob = { ms: 4001, at: 101 };
    const sessionTaps = mergeClutchTapsFrozen(
      mergeClutchTapsFrozen({}, { Alice: alice }),
      { Bob: bob }
    );
    // Reveal / scoring lit session.taps[name].ms — pas de Date.now() / performance.now()
    assert.equal(sessionTaps.Alice.ms, 4123);
    assert.equal(sessionTaps.Alice.at, 100);
    assert.equal(sessionTaps.Bob.ms, 4001);
    assert.equal(sessionTaps.Bob.at, 101);
  });

  it("resolveClutchTapCommitFailureUi libère verrou et rouvre la fenêtre", () => {
    assert.deepEqual(resolveClutchTapCommitFailureUi(), {
      tapCommitInFlight: false,
      localWindowClosed: false,
    });
  });
});
