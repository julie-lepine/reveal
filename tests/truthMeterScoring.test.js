import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { awardTruthMeterRound } from "../js/core/scoring.js";

describe("awardTruthMeterRound", () => {
  it("auteur à 19 d'écart : 0 pt ; le plus proche prend +10", () => {
    const award = awardTruthMeterRound({ Léa: 0 }, "Noah", 19);
    assert.equal(award.gap, 19);
    assert.equal(award.authorPoints, 0);
    assert.equal(award.bluffWin, false);
    assert.equal(award.deltas.Noah, undefined);
    assert.deepEqual(award.closeVoters, ["Léa"]);
    assert.equal(award.deltas.Léa, 10);
    assert.equal(award.voterPoints, 10);
  });

  it("auteur à 20 d'écart : +15", () => {
    const award = awardTruthMeterRound({ Léa: 0 }, "Noah", 20);
    assert.equal(award.gap, 20);
    assert.equal(award.authorPoints, 15);
    assert.equal(award.bluffWin, true);
    assert.equal(award.deltas.Noah, 15);
    assert.equal(award.deltas.Léa, 10);
  });

  it("ex æquo : chaque plus proche prend +10", () => {
    const award = awardTruthMeterRound({ Léa: 0, Tom: 40 }, "Noah", 20);
    assert.equal(award.groupAvg, 20);
    assert.equal(award.authorPoints, 0);
    assert.deepEqual(award.closeVoters, ["Léa", "Tom"]);
    assert.equal(award.deltas.Léa, 10);
    assert.equal(award.deltas.Tom, 10);
    assert.equal(award.deltas.Noah, undefined);
  });

  it("un seul plus proche marque, les autres votants restent à 0", () => {
    const award = awardTruthMeterRound({ Léa: 0, Tom: 10, Mia: 100 }, "Noah", 10);
    assert.equal(award.groupAvg, 37);
    assert.equal(award.authorPoints, 15);
    assert.deepEqual(award.closeVoters, ["Tom"]);
    assert.equal(award.deltas.Tom, 10);
    assert.equal(award.deltas.Léa, undefined);
    assert.equal(award.deltas.Mia, undefined);
  });
});
