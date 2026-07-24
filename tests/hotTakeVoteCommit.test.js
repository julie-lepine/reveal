import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeHotTakeVoteApply } from "../js/core/hotTakeVoteCommit.js";

describe("T-05 Hot Take vote commit / rollback", () => {
  it("applique le vote local et expose previousVotes pour rollback", () => {
    const out = computeHotTakeVoteApply(
      { votes: { Bob: "A" } },
      "Alice",
      "B"
    );
    assert.deepEqual(out.previousVotes, { Bob: "A" });
    assert.deepEqual(out.nextVotes, { Bob: "A", Alice: "B" });
  });

  it("rollback : previousVotes sans le vote local après échec sync", () => {
    const { previousVotes, nextVotes } = computeHotTakeVoteApply({ votes: {} }, "Alice", "C");
    assert.equal(nextVotes.Alice, "C");
    assert.equal(previousVotes.Alice, undefined);
  });

  it("remplace un vote local existant tout en gardant le snapshot précédent", () => {
    const out = computeHotTakeVoteApply(
      { votes: { Alice: "A", Bob: "B" } },
      "Alice",
      "C"
    );
    assert.equal(out.previousVotes.Alice, "A");
    assert.equal(out.nextVotes.Alice, "C");
    assert.equal(out.nextVotes.Bob, "B");
  });
});
