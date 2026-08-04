import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isNewSpeedVoteVoteRound } from "../js/core/sessionMerge.js";
import {
  isTierNightLiveRemoteReset,
  tierNightLiveRunIdsDiffer,
  isNewTierNightLiveVoteRound,
  mergeTierNightLiveVotesForHydrate,
  mergeTierNightLiveVotesForPatch,
  mergeTierNightLiveGameFields,
} from "../js/core/tierNightLiveMerge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const newLiveRemote = (extra = {}) => ({
  runId: "new-run",
  lobbyStarted: true,
  finished: false,
  phase: "voting",
  roundIdx: 0,
  votes: {},
  placements: {},
  playerRoster: [
    { userId: "u-a", displayName: "Alice" },
    { userId: "u-b", displayName: "Bob" },
  ],
  deck: ["Alien"],
  ...extra,
});

describe("BUG-TIERNIGHT-05 - isNewTierNightLiveVoteRound", () => {
  it("runIds différents + votes remote vides → nouveau round", () => {
    const local = {
      runId: "old",
      phase: "voting",
      roundIdx: 0,
      votes: { Alice: "S" },
    };
    const remote = newLiveRemote();
    assert.equal(isNewSpeedVoteVoteRound(local, remote), false);
    assert.equal(tierNightLiveRunIdsDiffer(local, remote), true);
    assert.equal(isNewTierNightLiveVoteRound(local, remote), true);
  });

  it("isRemoteReset seul (même run, 1re manche) ne wipe pas le vote optimiste", () => {
    const local = {
      runId: "r1",
      phase: "voting",
      roundIdx: 0,
      votes: { Alice: "S" },
      lobbyStarted: true,
      finished: false,
    };
    const remote = {
      runId: "r1",
      lobbyStarted: true,
      finished: false,
      phase: "voting",
      roundIdx: 0,
      votes: {},
      placements: {},
    };
    assert.equal(isTierNightLiveRemoteReset(remote), true);
    assert.equal(isNewTierNightLiveVoteRound(local, remote), false);
    assert.deepEqual(mergeTierNightLiveVotesForHydrate(local, remote), {
      Alice: "S",
    });
  });

  it("remote finished → wipe même si runId identique", () => {
    const local = { runId: "r1", votes: { Alice: "S" }, lobbyStarted: true };
    const remote = {
      runId: "r1",
      lobbyStarted: false,
      finished: true,
      votes: {},
      phase: "done",
    };
    assert.equal(isNewTierNightLiveVoteRound(local, remote), true);
    assert.deepEqual(mergeTierNightLiveVotesForHydrate(local, remote), {});
  });

  it("local sans runId + remote avec runId → adopter remote", () => {
    const local = { votes: { Alice: "S" }, phase: "voting", roundIdx: 0 };
    const remote = newLiveRemote();
    assert.equal(isNewTierNightLiveVoteRound(local, remote), true);
    assert.deepEqual(mergeTierNightLiveVotesForHydrate(local, remote), {});
  });

  it("manche suivante même run → true via isNewSpeedVoteVoteRound", () => {
    const cur = { runId: "r1", phase: "reveal", roundIdx: 0, votes: { a: "S" } };
    const inc = { runId: "r1", phase: "voting", roundIdx: 1, votes: {} };
    assert.equal(isNewSpeedVoteVoteRound(cur, inc), true);
    assert.equal(isNewTierNightLiveVoteRound(cur, inc), true);
  });
});

describe("BUG-TIERNIGHT-05 - merge hydrate", () => {
  it("nouveau run + remote vide → votes {}", () => {
    const local = {
      runId: "old",
      phase: "voting",
      roundIdx: 0,
      votes: { Alice: "S" },
    };
    const remote = newLiveRemote();
    assert.deepEqual(mergeTierNightLiveVotesForHydrate(local, remote), {});
  });

  it("nouveau run + votes distants → remote seul (Alice locale droppée)", () => {
    const local = {
      runId: "old",
      phase: "voting",
      roundIdx: 0,
      votes: { Alice: "S" },
    };
    const remote = newLiveRemote({ votes: { Bob: "A" } });
    assert.deepEqual(mergeTierNightLiveVotesForHydrate(local, remote), { Bob: "A" });
  });

  it("même run, même manche → local-first additif", () => {
    const local = {
      runId: "r1",
      phase: "voting",
      roundIdx: 0,
      votes: { Alice: "S" },
      lobbyStarted: true,
      finished: false,
      placements: { Alice: { S: ["Alien"] } },
    };
    const remote = {
      runId: "r1",
      phase: "voting",
      roundIdx: 0,
      votes: { Bob: "A" },
      lobbyStarted: true,
      finished: false,
      placements: { Alice: { S: ["Alien"] } },
    };
    assert.equal(isNewTierNightLiveVoteRound(local, remote), false);
    assert.deepEqual(mergeTierNightLiveVotesForHydrate(local, remote), {
      Bob: "A",
      Alice: "S",
    });
  });

  it("manche suivante même run → votes remote (vides)", () => {
    const local = {
      runId: "r1",
      phase: "reveal",
      roundIdx: 0,
      votes: { Alice: "S" },
    };
    const remote = {
      runId: "r1",
      phase: "voting",
      roundIdx: 1,
      votes: {},
      lobbyStarted: true,
      finished: false,
      placements: { Alice: { S: ["Alien"] } },
    };
    assert.deepEqual(mergeTierNightLiveVotesForHydrate(local, remote), {});
  });

  it("hydratation complète : nouveau run garde deck/roster, wipe votes", () => {
    const local = {
      runId: "old",
      deck: ["Old"],
      playerRoster: [{ userId: "u-x", displayName: "X" }],
      votes: { Alice: "S" },
      phase: "voting",
      roundIdx: 0,
      placements: { Alice: { S: ["Old"] } },
    };
    const remote = newLiveRemote({ deck: ["Alien", "Dune"] });
    const out = mergeTierNightLiveGameFields(local, remote);
    assert.equal(out.runId, "new-run");
    assert.deepEqual(out.votes, {});
    assert.deepEqual(out.deck, ["Alien", "Dune"]);
    assert.deepEqual(out.playerRoster, remote.playerRoster);
    assert.deepEqual(out.placements, {});
  });
});

describe("BUG-TIERNIGHT-05 - merge patch (même contrat reset)", () => {
  it("nouveau run → remote uniquement", () => {
    const cur = { runId: "old", phase: "voting", roundIdx: 0, votes: { u1: "S" } };
    const inc = {
      runId: "new",
      phase: "voting",
      roundIdx: 0,
      votes: {},
      lobbyStarted: true,
      finished: false,
      placements: {},
    };
    assert.deepEqual(mergeTierNightLiveVotesForPatch(cur, inc), {});
  });

  it("nouveau run avec votes distants → Bob seul", () => {
    const cur = { runId: "old", votes: { u1: "S" } };
    const inc = newLiveRemote({ votes: { u2: "A" } });
    assert.deepEqual(mergeTierNightLiveVotesForPatch(cur, inc), { u2: "A" });
  });

  it("même run votes-only → additif incoming-first", () => {
    const cur = { runId: "r1", phase: "voting", roundIdx: 0, votes: { u1: "S" } };
    const inc = { votes: { u2: "A" } };
    assert.equal(isNewTierNightLiveVoteRound(cur, inc), false);
    assert.deepEqual(mergeTierNightLiveVotesForPatch(cur, inc), {
      u1: "S",
      u2: "A",
    });
  });

  it("remote finished → votes remote", () => {
    const cur = { runId: "r1", votes: { u1: "S" }, lobbyStarted: true };
    const inc = {
      runId: "r1",
      lobbyStarted: false,
      finished: true,
      votes: {},
      phase: "done",
    };
    assert.deepEqual(mergeTierNightLiveVotesForPatch(cur, inc), {});
  });
});

describe("BUG-TIERNIGHT-05 - UI / pickTier (dérivé de votes)", () => {
  it("après nouveau run, myVote équivalent est null et X=0", () => {
    const local = {
      runId: "old",
      votes: { Alice: "S" },
      phase: "voting",
      roundIdx: 0,
    };
    const remote = newLiveRemote();
    const votes = mergeTierNightLiveVotesForHydrate(local, remote);
    const localName = "Alice";
    const myVote = votes[localName] || null;
    assert.equal(myVote, null);
    assert.equal(Object.keys(votes).length, 0);
  });
});

describe("BUG-TIERNIGHT-05 - non-régression SpeedVote", () => {
  it("isNewSpeedVoteVoteRound n'est pas modifié (pas de runId dans le corps)", () => {
    const src = readFileSync(join(root, "js/core/sessionMerge.js"), "utf8");
    const fn = src.match(
      /export function isNewSpeedVoteVoteRound\([\s\S]*?\n\}/
    )?.[0];
    assert.ok(fn);
    assert.equal(fn.includes("runId"), false);
  });

  it("SpeedVote : roundIdx+ reset ; votes-only même manche pas reset", () => {
    assert.equal(
      isNewSpeedVoteVoteRound(
        { phase: "reveal", roundIdx: 0, votes: { a: "S" } },
        { phase: "voting", roundIdx: 1, votes: {} }
      ),
      true
    );
    assert.equal(
      isNewSpeedVoteVoteRound(
        { phase: "voting", roundIdx: 0, votes: { a: "S" } },
        { votes: { b: "A" } }
      ),
      false
    );
  });

  it("helper TierNight Live vit dans un module dédié (pas sessionMerge)", () => {
    const merge = readFileSync(join(root, "js/core/tierNightLiveMerge.js"), "utf8");
    assert.match(merge, /isNewTierNightLiveVoteRound/);
    assert.match(merge, /mergeTierNightLiveVotesForHydrate/);
    assert.match(merge, /mergeTierNightLiveVotesForPatch/);
  });
});
