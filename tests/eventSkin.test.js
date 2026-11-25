import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_SKIN_OVERRIDE,
  EVENT_SKINS,
  isDateInSkinWindow,
  resolveEventSkin,
  skinForDate,
  toLocalDateKey,
  toLocalMonthDayKey,
} from "../data/eventSkin.js";

describe("event skin calendar", () => {
  it("ships with the calendar on (override null)", () => {
    assert.equal(EVENT_SKIN_OVERRIDE, null);
  });

  it("registers the extra seasonal skins", () => {
    assert.equal(EVENT_SKINS.test21, undefined);
    assert.equal(EVENT_SKINS.aprilfools.start, "03-31");
    assert.equal(EVENT_SKINS.music.end, "06-23");
    assert.equal(EVENT_SKINS.bastille.start, "07-12");
    assert.equal(EVENT_SKINS.rentree.end, "09-16");
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
    assert.equal(skinForDate(new Date(2026, 8, 21)), null);
    assert.equal(skinForDate(new Date(2026, 8, 20)), null);
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

  it("uses the shipped override (calendar) when no query is present", () => {
    const outOfSeason = resolveEventSkin({
      now: new Date(2026, 8, 17),
      search: "",
    });
    assert.equal(outOfSeason, null);

    const christmasWindow = resolveEventSkin({
      now: new Date(2026, 11, 10),
      search: "",
    });
    assert.equal(christmasWindow?.id, "christmas");
  });

  it("override off hides calendar skins", () => {
    assert.equal(
      resolveEventSkin({ now: new Date(2026, 9, 15), search: "", override: "off" }),
      null
    );
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
    assert.equal(toLocalMonthDayKey(new Date(2026, 9, 1)), "10-01");
  });

  it("dates sans année : chaque skin revient tous les ans", () => {
    for (const skin of Object.values(EVENT_SKINS)) {
      assert.match(skin.start, /^\d{2}-\d{2}$/, skin.id);
      assert.match(skin.end, /^\d{2}-\d{2}$/, skin.id);
    }
    for (const year of [2026, 2027, 2028, 2031]) {
      assert.equal(skinForDate(new Date(year, 9, 31))?.id, "halloween", String(year));
      assert.equal(skinForDate(new Date(year, 11, 24))?.id, "christmas", String(year));
      assert.equal(skinForDate(new Date(year, 6, 14))?.id, "bastille", String(year));
      assert.equal(skinForDate(new Date(year, 8, 15))?.id, "rentree", String(year));
      assert.equal(skinForDate(new Date(year, 8, 16)), null, String(year));
    }
  });

  it("Nouvel An à cheval sur le 1er janvier", () => {
    assert.equal(skinForDate(new Date(2026, 11, 25))?.id, "christmas");
    assert.equal(skinForDate(new Date(2026, 11, 26))?.id, "nye");
    assert.equal(skinForDate(new Date(2026, 11, 31, 23, 59))?.id, "nye");
    assert.equal(skinForDate(new Date(2027, 0, 1))?.id, "nye");
    assert.equal(skinForDate(new Date(2028, 0, 2))?.id, "nye");
    assert.equal(skinForDate(new Date(2028, 0, 3)), null);
    assert.equal(skinForDate(new Date(2027, 5, 15)), null);
  });

  it("une seule peau à la fois sur toute l'année", () => {
    const skins = Object.values(EVENT_SKINS);
    for (let d = new Date(2028, 0, 1); d.getFullYear() === 2028; d.setDate(d.getDate() + 1)) {
      const hits = skins.filter((s) => isDateInSkinWindow(d, s)).map((s) => s.id);
      assert.ok(hits.length <= 1, `${toLocalDateKey(d)} : ${hits.join(", ")}`);
    }
  });
});
