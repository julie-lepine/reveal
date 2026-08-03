/**
 * SYN-VOTE-ROLLBACK-01 — contrats source des commits + SpeedVote UI.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function fnBlock(src, exportName, nextExport) {
  const start = src.indexOf(`export async function ${exportName}`);
  assert.ok(start >= 0, `missing ${exportName}`);
  const end =
    nextExport != null
      ? src.indexOf(`export `, start + 10)
      : src.length;
  return src.slice(start, end > start ? end : undefined);
}

const ROLLBACK_MARKERS = [
  "computeOptimisticMapEntryApply",
  "rollbackOptimisticMapEntry",
  "canRollbackOptimisticSubmission",
  "catch (err)",
  "throw err",
];

describe("SYN-VOTE-ROLLBACK-01 — contrats commit*", () => {
  const cases = [
    ["js/core/speedVoteSession.js", "commitSpeedVoteVote"],
    ["js/core/dilemmaSession.js", "commitDilemmaVote"],
    ["js/core/wrongAnswerSession.js", "commitWrongAnswerVote"],
    ["js/core/wrongAnswerSession.js", "commitWrongAnswerAnswer"],
    ["js/core/traitreSession.js", "commitTraitreVote"],
    ["js/core/tierNightLiveSession.js", "commitTierNightLiveVote"],
  ];

  for (const [file, name] of cases) {
    it(`${name} : apply + rollback conditionnel + rethrow`, () => {
      const src = read(file);
      const block = fnBlock(src, name);
      for (const m of ROLLBACK_MARKERS) {
        assert.match(block, new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      assert.match(block, /attemptId/);
      assert.equal(block.includes("catch (() => {})"), false);
      assert.equal(block.includes(".catch(() => {})"), false);
    });
  }

  it("TierNight Live capture runId", () => {
    const block = fnBlock(read("js/core/tierNightLiveSession.js"), "commitTierNightLiveVote");
    assert.match(block, /runId:\s*session\.runId/);
  });

  it("commitTraitreDealAck hors périmètre (pas de rollback vote helper)", () => {
    const src = read("js/core/traitreSession.js");
    const block = fnBlock(src, "commitTraitreDealAck", "commitTraitreVote");
    assert.equal(block.includes("rollbackOptimisticMapEntry"), false);
    assert.match(block, /dealAcks/);
  });
});

describe("SYN-VOTE-ROLLBACK-01 — UI SpeedVote / WAO", () => {
  it("SpeedVote : myVote après succès uniquement (MP)", () => {
    const src = read("js/games/speedVote.js");
    const start = src.indexOf('app.querySelectorAll("[data-vote-player]")');
    const block = src.slice(start, start + 1200);
    assert.match(block, /await commitSpeedVoteVote/);
    assert.match(block, /catch\s*\{/);
    const assignBefore = block.search(/myVote\s*=\s*target/);
    const awaitIdx = block.indexOf("await commitSpeedVoteVote");
    // Solo peut encore assigner myVote = target après branche else ; MP : assign après succès.
    const mpTry = block.slice(block.indexOf("if (mp)"), block.indexOf("} else {"));
    assert.match(mpTry, /catch/);
    assert.ok(mpTry.indexOf("await commitSpeedVoteVote") >= 0);
    assert.ok(
      mpTry.indexOf("myVote =") < 0 ||
        mpTry.indexOf("myVote =") > mpTry.indexOf("await commitSpeedVoteVote")
    );
    void assignBefore;
    void awaitIdx;
  });

  it("WAO answer : catch conserve draft (pas draftText = \"\" dans catch)", () => {
    const src = read("js/games/wrongAnswer.js");
    const start = src.indexOf("await commitWrongAnswerAnswer(text)");
    assert.ok(start >= 0);
    const block = src.slice(start - 80, start + 700);
    assert.match(block, /try\s*\{/);
    assert.match(block, /catch\s*\{/);
    const catchIdx = block.indexOf("catch");
    const afterCatch = block.slice(catchIdx, block.indexOf("draftText = \"\"", catchIdx));
    // Le clear draft n'est que sur le chemin succès (après le catch return).
    assert.match(afterCatch, /return/);
    assert.equal(afterCatch.includes('draftText = ""'), false);
    assert.match(afterCatch, /refreshWrongAnswerResponseProgress/);
  });

  it("WAO vote : catch → refreshWrongAnswerVoteProgress (pas full render)", () => {
    const src = read("js/games/wrongAnswer.js");
    const start = src.indexOf('app.querySelector("#wrong-confirm-vote")?.addEventListener');
    assert.ok(start >= 0, "confirm-vote listener missing");
    const block = src.slice(start, start + 900);
    assert.match(block, /commitWrongAnswerVote/);
    const catchStart = block.indexOf("catch");
    assert.ok(catchStart >= 0);
    const catchBlock = block.slice(catchStart, catchStart + 350);
    assert.match(catchBlock, /refreshWrongAnswerVoteProgress/);
    assert.equal(catchBlock.includes("render()"), false);
  });

  it("références saines Hot Take / Guess Lie intactes", () => {
    const ht = read("js/core/hotTakeSession.js");
    assert.match(ht, /computeHotTakeVoteApply/);
    assert.match(ht, /previousVotes/);
    const gl = read("js/core/guessLieVoteCommit.js");
    assert.match(gl, /rollbackGuessLieOptimisticVote/);
  });
});
