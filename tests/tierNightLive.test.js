import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeSpeedVotePatchState,
  isNewSpeedVoteVoteRound,
} from "../js/core/sessionMerge.js";

// Réplique exacte du merge des votes live (gameSync.mergeRemoteTierNightLiveVotesUid) :
// additif pendant une manche, reset uniquement sur une nouvelle manche.
function mergeLiveVotes(cur, inc) {
  if (isNewSpeedVoteVoteRound(cur, inc)) return inc?.votes || {};
  return { ...(cur?.votes || {}), ...(inc?.votes || {}) };
}

const mergeReadyUid = (a, b) => ({ ...(a?.ready || {}), ...(b?.ready || {}) });

function merge(cur, inc) {
  return mergeSpeedVotePatchState(cur, inc, {
    mergeReadyUid,
    mergeVotes: mergeLiveVotes,
  });
}

describe("tierNightLive — merge des votes", () => {
  it("un patch votes-only conserve les votes des autres joueurs", () => {
    const cur = { phase: "voting", roundIdx: 0, votes: { u1: "S" } };
    const inc = { votes: { u2: "B" } };
    const out = merge(cur, inc);
    assert.deepEqual(out.votes, { u1: "S", u2: "B" });
    assert.equal(out.phase, "voting");
  });

  it("plusieurs votes successifs s'accumulent", () => {
    let state = { phase: "voting", roundIdx: 0, votes: {} };
    state = merge(state, { votes: { a: "A" } });
    state = merge(state, { votes: { b: "C" } });
    state = merge(state, { votes: { c: "S" } });
    assert.deepEqual(state.votes, { a: "A", b: "C", c: "S" });
  });

  it("une nouvelle manche (roundIdx change, votes vides) réinitialise les votes", () => {
    const cur = { phase: "reveal", roundIdx: 0, votes: { u1: "S", u2: "B" } };
    const inc = { phase: "voting", roundIdx: 1, votes: {} };
    const out = merge(cur, inc);
    assert.deepEqual(out.votes, {});
    assert.equal(out.roundIdx, 1);
    assert.equal(out.phase, "voting");
  });

  it("le passage en reveal conserve les votes accumulés", () => {
    const cur = { phase: "voting", roundIdx: 2, votes: { u1: "A", u2: "A" } };
    const inc = { phase: "reveal" };
    const out = merge(cur, inc);
    assert.deepEqual(out.votes, { u1: "A", u2: "A" });
    assert.equal(out.phase, "reveal");
  });

  it("un vote retardataire pendant reveal ne régresse pas la phase", () => {
    const cur = { phase: "reveal", roundIdx: 2, votes: { u1: "A" } };
    const inc = { votes: { u2: "D" } };
    const out = merge(cur, inc);
    assert.deepEqual(out.votes, { u1: "A", u2: "D" });
    assert.equal(out.phase, "reveal");
  });
});
