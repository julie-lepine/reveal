import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_SKIN_OVERRIDE,
  EVENT_SKINS,
  isDateInSkinWindow,
  resolveEventSkin,
  skinForDate,
  toLocalDateKey,
} from "../data/eventSkin.js";

describe("event skin calendar", () => {
  it("leaves production on the calendar (no forced skin)", () => {
    assert.equal(EVENT_SKIN_OVERRIDE, null);
  });

  it("registers the extra seasonal skins", () => {
    assert.equal(EVENT_SKINS.test21.start, "2026-09-21");
    assert.equal(EVENT_SKINS.test21.end, "2026-09-22");
    assert.equal(EVENT_SKINS.aprilfools.start, "2027-03-31");
    assert.equal(EVENT_SKINS.music.end, "2027-06-23");
    assert.equal(EVENT_SKINS.bastille.start, "2027-07-12");
    assert.equal(EVENT_SKINS.rentree.end, "2027-09-16");
  });

  it("maps local dates into inclusive/exclusive windows", () => {
    const h = EVENT_SKINS.halloween;
    assert.equal(isDateInSkinWindow(new Date(2026, 9, 1), h), true);
    assert.equal(isDateInSkinWindow(new Date(2026, 9, 31), h), true);
    assert.equal(isDateInSkinWindow(new Date(2026, 10, 1), h), false);
    assert.equal(isDateInSkinWindow(new Date(2026, 8, 17), h), false);
  });

  it("picks the matching skin for a date", () => {
    assert.equal(skinForDate(new Date(2026, 9, 20))?.id, "halloween");
    assert.equal(skinForDate(new Date(2026, 11, 24))?.id, "christmas");
    assert.equal(skinForDate(new Date(2027, 3, 1))?.id, "aprilfools");
    assert.equal(skinForDate(new Date(2027, 5, 21))?.id, "music");
    assert.equal(skinForDate(new Date(2027, 6, 14))?.id, "bastille");
    assert.equal(skinForDate(new Date(2027, 8, 5))?.id, "rentree");
    assert.equal(skinForDate(new Date(2026, 8, 21))?.id, "test21");
    assert.equal(skinForDate(new Date(2026, 8, 20)), null);
    assert.equal(skinForDate(new Date(2026, 8, 22)), null);
    assert.equal(skinForDate(new Date(2026, 8, 17)), null);
  });

  it("lets ?event= override the proto flag and the calendar", () => {
    const halloween = resolveEventSkin({
      now: new Date(2026, 8, 17),
      search: "?event=halloween",
      override: "off",
    });
    assert.equal(halloween?.id, "halloween");

    const off = resolveEventSkin({
      now: new Date(2026, 9, 20),
      search: "?event=off",
      override: "halloween",
    });
    assert.equal(off, null);
  });

  it("uses the shipped override (null) when no query is present", () => {
    const outOfSeason = resolveEventSkin({
      now: new Date(2026, 8, 17),
      search: "",
    });
    assert.equal(outOfSeason, null);

    const halloween = resolveEventSkin({
      now: new Date(2026, 9, 15),
      search: "",
    });
    assert.equal(halloween?.id, "halloween");
  });

  it("falls back to the calendar when override is null", () => {
    const inWindow = resolveEventSkin({
      now: new Date(2026, 9, 15),
      search: "",
      override: null,
    });
    assert.equal(inWindow?.id, "halloween");

    const out = resolveEventSkin({
      now: new Date(2026, 8, 17),
      search: "",
      override: null,
    });
    assert.equal(out, null);
  });

  it("formats local date keys without UTC shift surprises", () => {
    assert.equal(toLocalDateKey(new Date(2026, 9, 1)), "2026-10-01");
  });
});
