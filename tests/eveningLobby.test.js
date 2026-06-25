import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hasEveningStatsActivity, getState, saveStatePatch, defaultEveningStats } from "../js/core/state.js";

describe("hasEveningStatsActivity", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("faux avant toute partie", () => {
    saveStatePatch({ stats: defaultEveningStats(), scores: {}, eveningGamesRecorded: {} });
    assert.equal(hasEveningStatsActivity(), false);
  });

  it("vrai après des points enregistrés", () => {
    saveStatePatch({
      stats: defaultEveningStats(),
      scores: { Alice: 3 },
      eveningGamesRecorded: {},
    });
    assert.equal(hasEveningStatsActivity(), true);
  });

  it("vrai après une partie comptabilisée", () => {
    saveStatePatch({
      stats: { ...defaultEveningStats(), traitreGamesPlayed: 1 },
      scores: {},
      eveningGamesRecorded: {},
    });
    assert.equal(hasEveningStatsActivity(), true);
  });
});
