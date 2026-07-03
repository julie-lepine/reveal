import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TRAITRE_POINTS } from "../data/traitre.js";
import {
  buildTraitreEliminationPatch,
  computeTraitreScoreDeltas,
} from "../js/core/traitreScoring.js";

function baseSession(overrides = {}) {
  return {
    impostorName: "Bob",
    alive: ["Alice", "Bob", "Léa", "Tom"],
    eliminated: [],
    votes: {},
    voteSurvivals: 0,
    intuitionAwards: {},
    ...overrides,
  };
}

describe("buildTraitreEliminationPatch", () => {
  it("crédite la bonne intuition quand un civil éliminé avait visé le fake", () => {
    const session = baseSession({
      votes: { Alice: "Bob", Bob: "Alice", Léa: "Alice", Tom: "Alice" },
    });
    const patch = buildTraitreEliminationPatch(session, "Alice");
    assert.equal(patch.intuitionAwards.Alice, TRAITRE_POINTS.GOOD_INTUITION);
    assert.equal(patch.voteSurvivals, 1);
    assert.equal(patch.phase, "speak");
  });

  it("n'accorde pas d'intuition si le civil éliminé n'a pas voté le fake", () => {
    const session = baseSession({
      votes: { Alice: "Léa", Bob: "Alice", Léa: "Alice", Tom: "Alice" },
    });
    const patch = buildTraitreEliminationPatch(session, "Alice");
    assert.equal(patch.intuitionAwards.Alice, undefined);
  });

  it("passe en finale quand le fake est éliminé et garde le snapshot du vote", () => {
    const session = baseSession({
      votes: { Alice: "Bob", Bob: "Léa", Léa: "Bob", Tom: "Bob" },
    });
    const patch = buildTraitreEliminationPatch(session, "Bob");
    assert.equal(patch.phase, "final");
    assert.equal(patch.winner, "civilians");
    assert.equal(patch.lastVoteSnapshot.Tom, "Bob");
    assert.equal(patch.alive.length, 3);
  });
});

describe("computeTraitreScoreDeltas", () => {
  it("fake gagne : +15 + 10 par vote survécu", () => {
    const { deltas } = computeTraitreScoreDeltas(
      baseSession({
        winner: "traitre",
        alive: ["Bob", "Tom"],
        voteSurvivals: 2,
      })
    );
    assert.equal(deltas.Bob, TRAITRE_POINTS.FAKE_WIN + 2 * TRAITRE_POINTS.FAKE_SURVIVE_VOTE);
  });

  it("fake éliminé sans vote survécu : 0 pt", () => {
    const { deltas } = computeTraitreScoreDeltas(
      baseSession({
        winner: "civilians",
        alive: ["Alice", "Léa", "Tom"],
        eliminated: ["Bob"],
        voteSurvivals: 0,
        lastVoteSnapshot: { Alice: "Bob", Léa: "Bob", Tom: "Léa" },
      })
    );
    assert.equal(deltas.Bob ?? 0, 0);
  });

  it("fake éliminé après votes survécus : garde +10 par vote", () => {
    const { deltas } = computeTraitreScoreDeltas(
      baseSession({
        winner: "civilians",
        alive: ["Alice", "Léa", "Tom"],
        eliminated: ["Bob"],
        voteSurvivals: 2,
        lastVoteSnapshot: { Alice: "Bob", Léa: "Bob", Tom: "Léa" },
      })
    );
    assert.equal(deltas.Bob, 20);
  });

  it("victoire groupe : survivants +10, détectives +15 en plus", () => {
    const { deltas } = computeTraitreScoreDeltas(
      baseSession({
        winner: "civilians",
        alive: ["Alice", "Léa", "Tom"],
        eliminated: ["Bob"],
        voteSurvivals: 1,
        lastVoteSnapshot: { Alice: "Bob", Léa: "Bob", Tom: "Léa" },
      })
    );
    assert.equal(deltas.Alice, TRAITRE_POINTS.SURVIVOR + TRAITRE_POINTS.DETECTIVE_BONUS);
    assert.equal(deltas.Léa, TRAITRE_POINTS.SURVIVOR + TRAITRE_POINTS.DETECTIVE_BONUS);
    assert.equal(deltas.Tom, TRAITRE_POINTS.SURVIVOR);
    assert.equal(deltas.Bob, TRAITRE_POINTS.FAKE_SURVIVE_VOTE);
  });

  it("inclut les bonnes intuitions accumulées pendant la partie", () => {
    const { deltas } = computeTraitreScoreDeltas(
      baseSession({
        winner: "civilians",
        alive: ["Alice", "Léa", "Tom"],
        eliminated: ["Bob", "Eve"],
        voteSurvivals: 0,
        intuitionAwards: { Eve: TRAITRE_POINTS.GOOD_INTUITION },
        lastVoteSnapshot: { Alice: "Bob", Léa: "Bob", Tom: "Bob" },
      })
    );
    assert.equal(deltas.Eve, TRAITRE_POINTS.GOOD_INTUITION);
  });
});
