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
  it("SpeedVote : handleSpeedVotePick catch terminal + myVote post-succès", () => {
    const src = read("js/games/speedVote.js");
    assert.match(src, /async function handleSpeedVotePick/);
    assert.match(src, /void handleSpeedVotePick/);
    const start = src.indexOf("async function handleSpeedVotePick");
    const block = src.slice(start, start + 1800);
    assert.match(block, /await commitSpeedVoteVote/);
    assert.match(block, /Catch terminal UI/);
    assert.match(block, /pas de seconde notification/);
    const awaitIdx = block.indexOf("await commitSpeedVoteVote");
    const catchIdx = block.indexOf("catch (error)", awaitIdx);
    assert.ok(catchIdx > awaitIdx);
    const afterCatch = block.slice(catchIdx);
    // Après le return du catch : assign succès depuis session.
    assert.match(afterCatch, /return;\s*\}\s*if \(!mount\.isMounted/);
    assert.match(
      afterCatch,
      /myVote = getSpeedVoteSession\(\)\.votes\?\.\[[^\]]+\] \?\? target/
    );
  });

  it("SpeedVote : void listener → promesse du handler consommée via catch interne", () => {
    const src = read("js/games/speedVote.js");
    const start = src.indexOf('app.querySelectorAll("[data-vote-player]")');
    const block = src.slice(start, start + 400);
    assert.match(block, /void handleSpeedVotePick\(target\)/);
    assert.equal(block.includes("addEventListener(\"click\", async"), false);
  });

  it("WAO answer : catch conserve draft (pas draftText = \"\" dans catch)", () => {
    const src = read("js/games/wrongAnswer.js");
    const start = src.indexOf("await commitWrongAnswerAnswer(text)");
    assert.ok(start >= 0);
    const block = src.slice(start - 80, start + 800);
    assert.match(block, /try\s*\{/);
    assert.match(block, /catch\s*\(/);
    const catchIdx = block.indexOf("catch");
    const draftClear = block.indexOf('draftText = ""', catchIdx);
    const afterCatch =
      draftClear >= 0 ? block.slice(catchIdx, draftClear) : block.slice(catchIdx);
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
