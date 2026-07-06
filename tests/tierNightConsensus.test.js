import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  medianTierFromRanks,
  medianTierRank,
} from "../js/core/tierNightScoring.js";
import { computeConsensusPlaced, recapHasPlacements } from "../js/core/tierNightConsensus.js";

describe("medianTierRank / medianTierFromRanks", () => {
  it("4 joueurs 2×A + 2×D → médiane B", () => {
    assert.equal(medianTierFromRanks([1, 1, 4, 4]), "B");
    assert.equal(medianTierRank([1, 1, 4, 4]), 2);
  });

  it("2 joueurs A + D → médiane B", () => {
    assert.equal(medianTierFromRanks([1, 4]), "B");
  });

  it("3 joueurs : médiane classique", () => {
    assert.equal(medianTierFromRanks([0, 2, 4]), "B");
  });
});

describe("computeConsensusPlaced", () => {
  const items = ["XX"];

  function recap(player, tier) {
    const placed = { S: [], A: [], B: [], C: [], D: [] };
    placed[tier].push("XX");
    return { player, placed };
  }

  it("synthétise 2×A + 2×D en tier B", () => {
    const recaps = [recap("A1", "A"), recap("A2", "A"), recap("D1", "D"), recap("D2", "D")];
    const consensus = computeConsensusPlaced(recaps, items);
    assert.deepEqual(consensus.B, ["XX"]);
    assert.equal(consensus.A.length, 0);
    assert.equal(consensus.D.length, 0);
  });

  it("ignore les joueurs sans classement", () => {
    const recaps = [
      recap("A1", "A"),
      recap("A2", "A"),
      { player: "absent", placed: { S: [], A: [], B: [], C: [], D: [] } },
      { player: "absent2", placed: {} },
    ];
    assert.equal(recapHasPlacements(recaps[2]), false);
    const consensus = computeConsensusPlaced(recaps, items);
    assert.deepEqual(consensus.A, ["XX"]);
  });
});
