import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTierNightScoreBreakdown,
  tierNightPointsForItem,
} from "../js/core/tierNightScoring.js";
import { EVENING_POINTS } from "../data/eveningScoring.js";

describe("tierNightPointsForItem", () => {
  it("mode classique : même tier → +15", () => {
    assert.equal(tierNightPointsForItem("A", "A"), EVENING_POINTS.BONUS);
  });

  it("mode classique : 1 tier d'écart → +10", () => {
    assert.equal(tierNightPointsForItem("A", "B"), EVENING_POINTS.WIN);
  });

  it("mode à contre-courant : grand écart → +15", () => {
    assert.equal(tierNightPointsForItem("S", "D", { reverse: true }), EVENING_POINTS.BONUS);
  });
});

describe("buildTierNightScoreBreakdown", () => {
  const consensus = { S: [], A: ["McDo"], B: [], C: [], D: ["Pepsi"] };
  const placed = { S: [], A: ["McDo"], B: [], C: ["Pepsi"], D: [] };

  it("calcule la moyenne et le total avec bonus outsider", () => {
    const breakdown = buildTierNightScoreBreakdown(placed, consensus, {
      outsiderBonus: EVENING_POINTS.BONUS,
    });
    assert.equal(breakdown.rows.length, 2);
    assert.equal(breakdown.rows[0].pts, EVENING_POINTS.BONUS);
    assert.equal(breakdown.rows[1].pts, EVENING_POINTS.WIN);
    assert.equal(breakdown.proximityTotal, 13);
    assert.equal(breakdown.total, 13 + EVENING_POINTS.BONUS);
  });

  it("retourne 0 sans items", () => {
    const breakdown = buildTierNightScoreBreakdown({}, consensus);
    assert.equal(breakdown.itemCount, 0);
    assert.equal(breakdown.total, 0);
  });
});
