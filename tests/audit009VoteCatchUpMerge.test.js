/**
 * AUDIT-009 — HotTake / SpeedVote : catch-up votes (remote gagne A→B).
 * Contrat = mergePlayerVoteMapsForCatchUp (réf. Dilemma SYN-VOTE-ROLLBACK-01B).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergePlayerVoteMapsForCatchUp } from "../js/core/sessionMerge.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function extractFunctionBlock(src, fnName, maxLen = 2200) {
  const start = src.indexOf(`function ${fnName}`);
  assert.ok(start >= 0, `${fnName} missing`);
  return src.slice(start, start + maxLen);
}

describe("AUDIT-009 - mergePlayerVoteMapsForCatchUp (HotTake / SpeedVote)", () => {
  it("premier vote : remote Alice=A, local vide → A", () => {
    assert.deepEqual(mergePlayerVoteMapsForCatchUp({}, { Alice: "A" }), {
      Alice: "A",
    });
  });

  it("revote A→B : remote B remplace local stale A", () => {
    const out = mergePlayerVoteMapsForCatchUp(
      { Alice: "Valide", Bob: "Acceptable" },
      { Alice: "Criminel", Bob: "Acceptable" }
    );
    assert.equal(out.Alice, "Criminel");
    assert.equal(out.Bob, "Acceptable");
  });

  it("optimiste local-only conservé si absent du remote", () => {
    const out = mergePlayerVoteMapsForCatchUp(
      { Alice: "Valide", Bob: "Acceptable" },
      { Bob: "Acceptable" }
    );
    assert.equal(out.Alice, "Valide");
    assert.equal(out.Bob, "Acceptable");
  });

  it("preuve anti-pattern : {...remote,...local} gardait A", () => {
    const hostLocal = { Alice: "Valide" };
    const remoteAfterChange = { Alice: "Criminel" };
    const wrongOld = { ...remoteAfterChange, ...hostLocal };
    assert.equal(wrongOld.Alice, "Valide");
    assert.equal(
      mergePlayerVoteMapsForCatchUp(hostLocal, remoteAfterChange).Alice,
      "Criminel"
    );
  });

  it("compteur votants inchangé A→B", () => {
    const before = mergePlayerVoteMapsForCatchUp(
      {},
      { Alice: "Valide", Bob: "Criminel" }
    );
    const after = mergePlayerVoteMapsForCatchUp(before, {
      Alice: "Criminel",
      Bob: "Criminel",
    });
    assert.equal(Object.keys(before).length, 2);
    assert.equal(Object.keys(after).length, 2);
    assert.equal(after.Alice, "Criminel");
  });
});

describe("AUDIT-009 - contrats source merge*GameLocal", () => {
  it("mergeHotTakeGameLocal utilise mergePlayerVoteMapsForCatchUp", () => {
    const block = extractFunctionBlock(read("js/core/gameSync.js"), "mergeHotTakeGameLocal");
    assert.match(
      block,
      /mergePlayerVoteMapsForCatchUp\s*\(\s*localVotes\s*,\s*remoteVotes\s*\)/
    );
    assert.equal(block.includes("{ ...remoteVotes, ...localVotes }"), false);
  });

  it("mergeSpeedVoteGameLocal utilise mergePlayerVoteMapsForCatchUp", () => {
    const block = extractFunctionBlock(read("js/core/gameSync.js"), "mergeSpeedVoteGameLocal");
    assert.match(
      block,
      /mergePlayerVoteMapsForCatchUp\s*\(\s*localVotes\s*,\s*remoteVotes\s*\)/
    );
    assert.equal(block.includes("{ ...remoteVotes, ...localVotes }"), false);
  });

  it("Dilemma reste sur le même contrat (non régression)", () => {
    const block = extractFunctionBlock(read("js/core/gameSync.js"), "mergeDilemmaGameLocal");
    assert.match(
      block,
      /mergePlayerVoteMapsForCatchUp\s*\(\s*localVotes\s*,\s*remoteVotes\s*\)/
    );
  });
});
