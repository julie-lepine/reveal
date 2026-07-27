/**
 * Guess Lie vote commit — reveal bloqué pendant RPC + rollback / defer local.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldDeferGuessLieVoteLocalWrite,
  rollbackGuessLieOptimisticVote,
} from "../js/core/guessLieVoteCommit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSrc(rel) {
  return readFileSync(join(__dirname, rel), "utf8");
}

function allDetectivesVoted(votes, detectives) {
  return detectives.length > 0 && detectives.every((n) => votes[n] != null);
}

/** Miroir minimal tryAdvanceToReveal gates (guessLie.js). */
function canAutoAdvanceToReveal({ mp, phase, revealAdvancing, voteCommitInFlight, votes, detectives }) {
  if (!mp || phase !== "voting" || revealAdvancing) return false;
  if (voteCommitInFlight != null) return false;
  return allDetectivesVoted(votes, detectives);
}

describe("shouldDeferGuessLieVoteLocalWrite", () => {
  it("MP actif → defer (pas de save optimiste avant RPC)", () => {
    assert.equal(shouldDeferGuessLieVoteLocalWrite(true), true);
  });

  it("solo → écriture locale immédiate", () => {
    assert.equal(shouldDeferGuessLieVoteLocalWrite(false), false);
  });
});

describe("rollbackGuessLieOptimisticVote", () => {
  it("RPC rejetée : restaure previousPick si pending encore présent", () => {
    const rolled = rollbackGuessLieOptimisticVote(
      { Alice: 2, Bob: 0 },
      "Alice",
      2,
      { previousPick: 1, hadPrevious: true }
    );
    assert.deepEqual(rolled, { Alice: 1, Bob: 0 });
  });

  it("RPC rejetée : supprime la clé si aucun vote précédent", () => {
    const rolled = rollbackGuessLieOptimisticVote(
      { Alice: 1 },
      "Alice",
      1,
      { previousPick: null, hadPrevious: false }
    );
    assert.deepEqual(rolled, {});
  });

  it("sync distante pendant commit : ne détruit pas un vote différent", () => {
    const votes = { Alice: 2, Bob: 1 };
    const rolled = rollbackGuessLieOptimisticVote(
      votes,
      "Alice",
      0,
      { previousPick: null, hadPrevious: false }
    );
    assert.equal(rolled.Alice, 2);
    assert.equal(rolled.Bob, 1);
    assert.equal(rolled, votes);
  });

  it("sync distante même pick confirmé : no-op si current !== pending (défense)", () => {
    const votes = { Alice: 1 };
    const rolled = rollbackGuessLieOptimisticVote(
      votes,
      "Alice",
      2,
      { previousPick: 0, hadPrevious: true }
    );
    assert.equal(rolled, votes);
  });
});

describe("progression reveal pendant vote RPC", () => {
  const detectives = ["Alice", "Bob"];
  const allButLocal = { Alice: 0, Bob: 0 };

  it("RPC lente : voteCommitInFlight bloque reveal même si session complète fantôme", () => {
    const ghostSession = { ...allButLocal, Charlie: 1 };
    assert.equal(
      canAutoAdvanceToReveal({
        mp: true,
        phase: "voting",
        revealAdvancing: false,
        voteCommitInFlight: 1,
        votes: ghostSession,
        detectives: ["Alice", "Bob", "Charlie"],
      }),
      false
    );
  });

  it("defer local : session sans vote local pendant in-flight → pas all-voted", () => {
    assert.equal(
      canAutoAdvanceToReveal({
        mp: true,
        phase: "voting",
        revealAdvancing: false,
        voteCommitInFlight: 1,
        votes: allButLocal,
        detectives,
      }),
      false
    );
  });

  it("dernier détective + acting host : reveal seulement après in-flight cleared + votes confirmés", () => {
    assert.equal(
      canAutoAdvanceToReveal({
        mp: true,
        phase: "voting",
        revealAdvancing: false,
        voteCommitInFlight: null,
        votes: { Alice: 0, Bob: 1 },
        detectives,
      }),
      true
    );
    assert.equal(
      canAutoAdvanceToReveal({
        mp: true,
        phase: "voting",
        revealAdvancing: false,
        voteCommitInFlight: 1,
        votes: { Alice: 0 },
        detectives,
      }),
      false
    );
  });
});

describe("contrats source — commitGuessLieVote + tryAdvanceToReveal", () => {
  const sessionSrc = readSrc("../js/core/guessLieSession.js");
  const gameSrc = readSrc("../js/games/guessLie.js");

  it("MP : pas de saveStatePatch avant await patchGameStateWithFeedback", () => {
    const fn = sessionSrc.slice(sessionSrc.indexOf("export async function commitGuessLieVote"));
    const tryBlock = fn.slice(fn.indexOf("try {"), fn.indexOf("} catch"));
    assert.doesNotMatch(tryBlock, /saveStatePatch/);
    assert.match(tryBlock, /await patchGameStateWithFeedback/);
  });

  it("MP : save confirmé après succès RPC", () => {
    const fn = sessionSrc.slice(sessionSrc.indexOf("export async function commitGuessLieVote"));
    assert.match(fn, /}\s*catch \(err\)[\s\S]*}\s*\n\s*const live = getGuessLieSession\(\);[\s\S]*saveStatePatch/s);
  });

  it("échec RPC : rollbackGuessLieOptimisticVote invoqué", () => {
    assert.match(sessionSrc, /rollbackGuessLieOptimisticVote\(/);
    assert.match(sessionSrc, /catch \(err\)/);
  });

  it("tryAdvanceToReveal : garde voteCommitInFlight", () => {
    const fn = gameSrc.slice(gameSrc.indexOf("async function tryAdvanceToReveal"));
    const head = fn.slice(0, fn.indexOf("const gl = getGuessLieSession()"));
    assert.match(head, /voteCommitInFlight != null\) return/);
  });

  it("double clic : submitVote verrou in-flight", () => {
    assert.match(gameSrc, /if \(pick == null \|\| voteCommitInFlight != null\) return/);
    assert.match(gameSrc, /void submitVote\(localPick\(\)\)/);
  });
});
