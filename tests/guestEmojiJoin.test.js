import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GUEST_EMOJI,
  normalizeGuestEmoji,
} from "../data/profileEmojis.js";

describe("normalizeGuestEmoji", () => {
  it("defaults to theater mask when empty or unknown", () => {
    assert.equal(normalizeGuestEmoji(""), DEFAULT_GUEST_EMOJI);
    assert.equal(normalizeGuestEmoji(null), DEFAULT_GUEST_EMOJI);
    assert.equal(normalizeGuestEmoji(undefined), DEFAULT_GUEST_EMOJI);
    assert.equal(normalizeGuestEmoji("🦄"), DEFAULT_GUEST_EMOJI);
    assert.equal(normalizeGuestEmoji("😈"), DEFAULT_GUEST_EMOJI);
  });

  it("accepts known profile emojis", () => {
    assert.equal(normalizeGuestEmoji("🦊"), "🦊");
    assert.equal(normalizeGuestEmoji(" 🎲 "), "🎲");
    assert.equal(normalizeGuestEmoji("🎭"), "🎭");
  });
});
