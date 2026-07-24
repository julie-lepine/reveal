import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeClutchTapApply } from "../js/core/clutchTapCommit.js";

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
});
