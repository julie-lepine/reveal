import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLegacyJoinHash, stripLegacyJoinHashFromLocation } from "../js/core/legacyJoinHash.js";

describe("legacy #join= cleanup (M-12)", () => {
  it("detects only join invitation hashes", () => {
    assert.equal(isLegacyJoinHash("#join=ABC123"), true);
    assert.equal(isLegacyJoinHash("join=ABC123"), true);
    assert.equal(isLegacyJoinHash("#JOIN=xyz"), true);
    assert.equal(isLegacyJoinHash("#join=ABC&foo=1"), true);
    assert.equal(isLegacyJoinHash(""), false);
    assert.equal(isLegacyJoinHash("#"), false);
    assert.equal(isLegacyJoinHash("#access_token=tok&type=recovery"), false);
    assert.equal(isLegacyJoinHash("#type=recovery"), false);
    assert.equal(isLegacyJoinHash("#screen=lobby"), false);
  });

  it("stripLegacyJoinHashFromLocation is a no-op without a join hash", () => {
    // In Node there is typically no browser location; function must not throw.
    assert.equal(stripLegacyJoinHashFromLocation(), false);
  });
});
