/**
 * AUDIT-001 — matchScores stale après clear / nouvelle partie.
 * Contrat : hydrate full distingue clear autoritatif vs merge max catch-up ;
 * patch wire : omit conserve, `{}` explicite clear.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mergeMatchScoresLocal,
  shouldReplaceMatchScoresOnFullHydrate,
  mergeMatchScoresForFullHydrate,
  mergeMatchScoresPatchUid,
} from "../js/core/matchScoresMerge.js";
import {
  hydrateTruthMeterMatchScores,
  isTruthMeterRemoteScoreAuthority,
} from "../js/core/truthMeterVoteCommit.js";
import { isNewConsensusGame } from "../js/core/sessionMerge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

describe("AUDIT-001 mergeMatchScoresLocal baseline (catch-up)", () => {
  it("Test 2 — même partie : merge max conserve le plancher local", () => {
    const out = mergeMatchScoresLocal(
      { Alice: 20, Bob: 10 },
      { Alice: 25 }
    );
    assert.deepEqual(out, { Alice: 25, Bob: 10 });
  });
});

describe("AUDIT-001 shouldReplace / full hydrate", () => {
  it("Test 1 — HotTake clear autoritatif (prep / results)", () => {
    const local = {
      lobbyStarted: true,
      phase: "reveal",
      takeIdx: 4,
      matchScores: { Alice: 40 },
    };
    const remote = {
      lobbyStarted: false,
      phase: null,
      takeIdx: 0,
      matchScores: {},
    };
    assert.equal(shouldReplaceMatchScoresOnFullHydrate(local, remote), true);
    assert.deepEqual(mergeMatchScoresForFullHydrate(local, remote), {});
  });

  it("Test 3 — sticky clear après merge stale déjà en prep", () => {
    const local = {
      lobbyStarted: false,
      phase: null,
      matchScores: { Alice: 40 },
    };
    const remote = {
      lobbyStarted: false,
      phase: null,
      matchScores: {},
    };
    assert.equal(shouldReplaceMatchScoresOnFullHydrate(local, remote), true);
    assert.deepEqual(mergeMatchScoresForFullHydrate(local, remote), {});
  });

  it("Test 4 — refresh/hydrate : ancien local + remote nouvelle partie → {}", () => {
    const local = {
      lobbyStarted: false,
      phase: null,
      takeIdx: 0,
      matchScores: { Alice: 40, Bob: 15 },
    };
    const remote = {
      lobbyStarted: false,
      phase: null,
      takeIdx: 0,
      votes: {},
      matchScores: {},
    };
    assert.deepEqual(mergeMatchScoresForFullHydrate(local, remote), {});
  });

  it("launch play : remote vide + local stale + takeIdx 0 → replace", () => {
    const local = {
      lobbyStarted: false,
      phase: null,
      matchScores: { Alice: 40 },
    };
    const remote = {
      lobbyStarted: true,
      phase: "question",
      takeIdx: 0,
      takeScored: false,
      matchScores: {},
    };
    assert.equal(shouldReplaceMatchScoresOnFullHydrate(local, remote), true);
    assert.deepEqual(mergeMatchScoresForFullHydrate(local, remote), {});
  });

  it("intra-partie : remote non vide → merge max (pas de replace)", () => {
    const local = {
      lobbyStarted: true,
      phase: "reveal",
      takeIdx: 1,
      matchScores: { Alice: 20, Bob: 10 },
    };
    const remote = {
      lobbyStarted: true,
      phase: "reveal",
      takeIdx: 1,
      matchScores: { Alice: 25 },
    };
    assert.equal(shouldReplaceMatchScoresOnFullHydrate(local, remote), false);
    assert.deepEqual(mergeMatchScoresForFullHydrate(local, remote), {
      Alice: 25,
      Bob: 10,
    });
  });

  it("SpeedVote / Clutch / WAO / Dilemma — roundIdx 0 launch clear", () => {
    for (const roundKey of ["roundIdx"]) {
      const local = {
        lobbyStarted: true,
        phase: "reveal",
        [roundKey]: 3,
        matchScores: { Alice: 40 },
      };
      const remotePrep = {
        lobbyStarted: false,
        phase: null,
        [roundKey]: 0,
        matchScores: {},
      };
      assert.deepEqual(
        mergeMatchScoresForFullHydrate(local, remotePrep),
        {},
        `prep clear via ${roundKey}`
      );
      const remoteLaunch = {
        lobbyStarted: true,
        phase: "voting",
        [roundKey]: 0,
        roundScored: false,
        matchScores: {},
      };
      assert.deepEqual(
        mergeMatchScoresForFullHydrate(
          { lobbyStarted: false, phase: null, matchScores: { Alice: 40 } },
          remoteLaunch
        ),
        {},
        `launch clear via ${roundKey}`
      );
    }
  });
});

describe("AUDIT-001 cinq jeux — wiring hydrate", () => {
  const syncSrc = read("js/core/gameSync.js");

  it("Test 5 — HotTake / SpeedVote / Clutch / WrongAnswer / Dilemma utilisent full hydrate", () => {
    const expectedFns = [
      "mergeHotTakeGameLocal",
      "mergeSpeedVoteGameLocal",
      "mergeClutchGameLocal",
      "mergeWrongAnswerGameLocal",
      "mergeDilemmaGameLocal",
    ];
    for (const name of expectedFns) {
      const start = syncSrc.indexOf(`function ${name}`);
      assert.ok(start >= 0, `${name} missing`);
      const block = syncSrc.slice(start, start + 1800);
      assert.match(
        block,
        /mergeMatchScoresForFullHydrate\(local,\s*remote\)/,
        `${name} must use mergeMatchScoresForFullHydrate`
      );
      assert.doesNotMatch(
        block,
        /mergeMatchScoresLocal\(local\.matchScores/,
        `${name} must not call raw mergeMatchScoresLocal for hydrate`
      );
    }
  });

  it("patch paths des 5 jeux utilisent mergeMatchScoresPatchUid + hasOwn", () => {
    assert.match(syncSrc, /mergeMatchScoresPatchUid/);
    const markers = [
      "incHt.matchScores",
      "incSv.matchScores",
      "incRz.matchScores",
      "incWa.matchScores",
      "incDm.matchScores",
    ];
    for (const m of markers) {
      assert.match(syncSrc, new RegExp(m.replace(".", "\\.")));
    }
    assert.match(
      syncSrc,
      /hasOwnProperty\.call\(incHt,\s*"matchScores"\)/
    );
  });
});

describe("AUDIT-001 patch uid contrat", () => {
  it("Test 7 — clé absente : conserve cur (payload partiel / votes-only)", () => {
    const cur = { u1: 40, u2: 10 };
    const out = mergeMatchScoresPatchUid(cur, undefined, { keyPresent: false });
    assert.deepEqual(out, { u1: 40, u2: 10 });
  });

  it("clé présente + {} : clear autoritatif", () => {
    const out = mergeMatchScoresPatchUid({ u1: 40 }, {}, { keyPresent: true });
    assert.deepEqual(out, {});
  });

  it("clé présente + partial : merge max", () => {
    const out = mergeMatchScoresPatchUid(
      { u1: 20, u2: 10 },
      { u1: 25 },
      { keyPresent: true }
    );
    assert.deepEqual(out, { u1: 25, u2: 10 });
  });
});

describe("AUDIT-001 non-régression Trivia / TruthMeter / Consensus", () => {
  const syncSrc = read("js/core/gameSync.js");

  it("Test 6 — Trivia hydrate garde replace remote", () => {
    const start = syncSrc.indexOf("function mergeTriviaGameLocal");
    assert.ok(start >= 0);
    const block = syncSrc.slice(start, start + 2500);
    assert.match(block, /matchScores:\s*\{\s*\.\.\.\(remote\.matchScores\s*\|\|\s*\{\}\)\s*\}/);
    assert.doesNotMatch(block, /mergeMatchScoresForFullHydrate/);
  });

  it("TruthMeter garde hydrateTruthMeterMatchScores / run authority", () => {
    assert.match(syncSrc, /hydrateTruthMeterMatchScores/);
    assert.equal(
      isTruthMeterRemoteScoreAuthority(
        { runId: "r1", matchScores: { Alice: 40 } },
        { runId: "r2", matchScores: {} }
      ),
      true
    );
    assert.deepEqual(
      hydrateTruthMeterMatchScores(
        { runId: "r1", matchScores: { Alice: 40 } },
        { runId: "r2", matchScores: {} }
      ),
      {}
    );
  });

  it("Consensus isNewConsensusGame inchangé (prep shell)", () => {
    assert.equal(
      isNewConsensusGame(
        { lobbyStarted: true, phase: "final", matchScores: { A: 1 } },
        { lobbyStarted: false, phase: null, matchScores: {} }
      ),
      true
    );
    const start = syncSrc.indexOf("function mergeConsensusGameLocal");
    assert.ok(start >= 0);
    const block = syncSrc.slice(start, start + 900);
    assert.match(block, /isNewConsensusGame/);
    assert.doesNotMatch(block, /mergeMatchScoresForFullHydrate/);
  });
});

describe("AUDIT-001 acting-host base propre (contrat hydrate)", () => {
  it("après clear, applyMatchScoreDeltas part de {} → delta seul", () => {
    const local = {
      lobbyStarted: false,
      phase: null,
      matchScores: { Alice: 40 },
    };
    const remote = {
      lobbyStarted: true,
      phase: "question",
      takeIdx: 0,
      takeScored: false,
      matchScores: {},
    };
    const base = mergeMatchScoresForFullHydrate(local, remote);
    assert.deepEqual(base, {});
    const next = { ...base };
    next.Alice = (next.Alice || 0) + 10;
    assert.deepEqual(next, { Alice: 10 });
  });
});
