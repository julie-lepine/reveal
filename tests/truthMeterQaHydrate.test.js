/**
 * BUG-TRUTHMETER-01B QA — compteur hôte + convergence matchScores.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hydrateTruthMeterMatchScores,
  isTruthMeterRemoteScoreAuthority,
  countConfirmedVoterVotesInMap,
} from "../js/core/truthMeterVoteCommit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function mergeMatchScoresMax(local = {}, remote = {}) {
  const merged = { ...local };
  Object.entries(remote).forEach(([name, pts]) => {
    if (typeof pts === "number" && Number.isFinite(pts)) {
      merged[name] = Math.max(merged[name] || 0, pts);
    }
  });
  return merged;
}

describe("compteur TruthMeter — votes confirmés uniquement", () => {
  const voters = ["Alice", "Charlie"];

  it("hôte détective ayant voté, 2 votants → 1", () => {
    assert.equal(
      countConfirmedVoterVotesInMap({ Alice: 40, Bob: 80 }, voters),
      1
    );
  });

  it("hôte auteur, aucun vote → 0", () => {
    assert.equal(countConfirmedVoterVotesInMap({}, voters), 0);
  });

  it("hôte auteur, premier invité confirmé → 1", () => {
    assert.equal(countConfirmedVoterVotesInMap({ Alice: 55 }, voters), 1);
  });

  it("hôte auteur, deux invités confirmés → 2", () => {
    assert.equal(
      countConfirmedVoterVotesInMap({ Alice: 55, Charlie: 70 }, voters),
      2
    );
  });

  it("clé hors votants attendus ignorée", () => {
    assert.equal(
      countConfirmedVoterVotesInMap({ Bob: 90, Alice: 10, Ghost: 1 }, voters),
      1
    );
  });

  it("draft absent de la map → ne compte pas", () => {
    assert.equal(countConfirmedVoterVotesInMap({}, voters), 0);
  });
});

describe("hydratation matchScores — autorité serveur", () => {
  it("reveal scoré : remplace le local divergent (pas Math.max)", () => {
    const local = {
      runId: "r1",
      phase: "voting",
      roundScored: false,
      matchScores: { Alice: 99, Bob: 99 },
    };
    const remote = {
      runId: "r1",
      phase: "reveal",
      roundScored: true,
      matchScores: { Alice: 10, Bob: 15 },
    };
    assert.equal(isTruthMeterRemoteScoreAuthority(local, remote), true);
    assert.deepEqual(hydrateTruthMeterMatchScores(local, remote), {
      Alice: 10,
      Bob: 15,
    });
  });

  it("Realtime identique après RPC : idempotent (même map)", () => {
    const scored = {
      runId: "r1",
      phase: "reveal",
      roundScored: true,
      matchScores: { Alice: 10, Charlie: 15 },
    };
    const once = hydrateTruthMeterMatchScores({ matchScores: {} }, scored);
    const twice = hydrateTruthMeterMatchScores(
      { ...scored, matchScores: once },
      scored
    );
    assert.deepEqual(once, twice);
    assert.deepEqual(twice, { Alice: 10, Charlie: 15 });
  });

  it("nouveau runId : ancien matchScores ne survit pas", () => {
    const local = {
      runId: "old",
      phase: "reveal",
      roundScored: true,
      matchScores: { Alice: 50 },
    };
    const remote = {
      runId: "new",
      phase: "writing",
      roundScored: false,
      matchScores: {},
    };
    assert.deepEqual(hydrateTruthMeterMatchScores(local, remote), {});
  });

  it("voting non scorée : conserve merge max (pré-reveal)", () => {
    const local = {
      runId: "r1",
      phase: "voting",
      roundScored: false,
      matchScores: { Alice: 5 },
    };
    const remote = {
      runId: "r1",
      phase: "voting",
      roundScored: false,
      matchScores: { Alice: 3, Bob: 8 },
    };
    assert.equal(isTruthMeterRemoteScoreAuthority(local, remote), false);
    assert.deepEqual(hydrateTruthMeterMatchScores(local, remote), {
      Alice: 5,
      Bob: 8,
    });
    assert.deepEqual(mergeMatchScoresMax(local.matchScores, remote.matchScores), {
      Alice: 5,
      Bob: 8,
    });
  });

  it("deux invités + hôte convergent vers la row serveur", () => {
    const server = {
      runId: "r1",
      phase: "reveal",
      roundScored: true,
      matchScores: { Host: 15, G1: 10, G2: 10 },
    };
    const hostLocal = {
      runId: "r1",
      matchScores: { Host: 30, G1: 20, G2: 5 },
    };
    const g1Local = { runId: "r1", matchScores: {} };
    const g2Local = { runId: "r1", matchScores: { G2: 99 } };
    assert.deepEqual(hydrateTruthMeterMatchScores(hostLocal, server), server.matchScores);
    assert.deepEqual(hydrateTruthMeterMatchScores(g1Local, server), server.matchScores);
    assert.deepEqual(hydrateTruthMeterMatchScores(g2Local, server), server.matchScores);
  });
});

describe("contrats source — compteur + hydratation", () => {
  const gameSrc = readSrc("js/games/truthMeter.js");
  const syncSrc = readSrc("js/core/gameSync.js");
  const sessionSrc = readSrc("js/core/truthMeterSession.js");

  it("compteur utilise countConfirmedTruthMeterVoterVotes (pas votesForAward)", () => {
    assert.match(gameSrc, /countConfirmedTruthMeterVoterVotes/);
    const forceIdx = gameSrc.indexOf("Révéler maintenant");
    const slice = gameSrc.slice(forceIdx - 400, forceIdx + 80);
    assert.match(slice, /countConfirmedTruthMeterVoterVotes/);
    assert.doesNotMatch(slice, /Object\.keys\(votesForAward/);
  });

  it("skip-render compare lastRenderedVotesJson (pas prev pré-sync)", () => {
    assert.match(gameSrc, /lastRenderedVotesJson/);
    assert.match(gameSrc, /votesNow !== lastRenderedVotesJson/);
    assert.match(gameSrc, /refreshForceRevealCounter/);
  });

  it("mergeTruthMeterGameLocal hydrate via hydrateTruthMeterMatchScores", () => {
    assert.match(syncSrc, /hydrateTruthMeterMatchScores/);
    assert.match(syncSrc, /isTruthMeterRemoteScoreAuthority/);
    assert.match(syncSrc, /truthMeterVoteCommit/);
  });

  it("commitTruthMeterReveal MP : pas de scoring client + pas de patch evening RMW", () => {
    const start = sessionSrc.indexOf("export async function commitTruthMeterReveal");
    const end = sessionSrc.indexOf("export async function commitTruthMeterVote", start);
    const block = sessionSrc.slice(start, end);
    assert.match(block, /rpcRevealTruthMeterRound/);
    assert.equal(block.includes("awardTruthMeterRound"), false);
    assert.doesNotMatch(block, /withEveningScores:\s*true/);
  });

  it("transitionToReveal MP : pas d’awardTruthMeterRound", () => {
    const start = gameSrc.indexOf("async function transitionToReveal");
    const solo = gameSrc.indexOf("const author = authorLabel()", start);
    const mpBranch = gameSrc.slice(start, solo);
    assert.match(mpBranch, /commitTruthMeterReveal/);
    assert.equal(/\bawardTruthMeterRound\b/.test(mpBranch), false);
  });

  it("goToRevealPending ignore si déjà reveal scorée", () => {
    assert.match(
      gameSrc,
      /async function goToRevealPending[\s\S]*phase === "reveal"[\s\S]*roundScored/
    );
  });
});
