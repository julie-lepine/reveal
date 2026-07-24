import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeClutchTapApply,
  resolveClutchTapCommitFailureUi,
  simulateClutchTapCommitCycle,
} from "../js/core/clutchTapCommit.js";

describe("SYN-26 clutch tap commit / rollback", () => {
  it("applique un nouveau tap et expose previousTaps pour rollback", () => {
    const tap = { ms: 1200, at: 99 };
    const out = computeClutchTapApply({ taps: { Bob: { ms: 800, at: 1 } } }, "Alice", tap);
    assert.equal(out.alreadyTapped, false);
    assert.deepEqual(out.previousTaps, { Bob: { ms: 800, at: 1 } });
    assert.deepEqual(out.nextTaps, { Bob: { ms: 800, at: 1 }, Alice: tap });
    assert.deepEqual(out.tap, tap);
  });

  it("conserve le premier tap (pas de double apply)", () => {
    const first = { ms: 1000, at: 1 };
    const out = computeClutchTapApply({ taps: { Alice: first } }, "Alice", { ms: 2000, at: 2 });
    assert.equal(out.alreadyTapped, true);
    assert.equal(out.tap, first);
    assert.deepEqual(out.nextTaps, { Alice: first });
  });

  it("rollback : previousTaps sans la clé locale après échec sync", () => {
    const tap = { ms: 1500, at: 5 };
    const { previousTaps, nextTaps } = computeClutchTapApply({ taps: {} }, "Alice", tap);
    assert.equal(nextTaps.Alice.ms, 1500);
    assert.equal(previousTaps.Alice, undefined);
  });

  it("échec premier tap → rollback → verrou libéré → second tap autorisé et envoyé", () => {
    const out = simulateClutchTapCommitCycle({
      session: { taps: { Bob: { ms: 900, at: 1 } } },
      localName: "Alice",
      firstTap: { ms: 1100, at: 2 },
      secondTap: { ms: 1300, at: 3 },
      commitFails: true,
    });
    assert.equal(out.ok, true);
    assert.equal(out.canTapAfterFailure, true);
    assert.equal(out.secondTapSent, true);
    assert.equal(out.tapCommitInFlight, false);
    assert.equal(out.localWindowClosed, false);
    assert.equal(out.taps.Alice.ms, 1300);
    assert.equal(out.taps.Bob.ms, 900, "taps des autres inchangés");
    assert.deepEqual(out.sent, [{ ms: 1300, at: 3 }]);
  });

  it("resolveClutchTapCommitFailureUi libère verrou et rouvre la fenêtre", () => {
    assert.deepEqual(resolveClutchTapCommitFailureUi(), {
      tapCommitInFlight: false,
      localWindowClosed: false,
    });
  });
});
