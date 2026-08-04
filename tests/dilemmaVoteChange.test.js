/**
 * SYN-VOTE-ROLLBACK-01B - Dilemma changement de vote A→B + catch-up Realtime.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergePlayerVoteMapsForCatchUp,
  mergeDilemmaPatchState,
} from "../js/core/sessionMerge.js";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "../js/core/optimisticMapEntry.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("mergePlayerVoteMapsForCatchUp - A→B", () => {
  it("premier vote : remote Alice=A, local vide → A", () => {
    const out = mergePlayerVoteMapsForCatchUp({}, { Alice: "A" });
    assert.deepEqual(out, { Alice: "A" });
  });

  it("changement A→B : remote B remplace local A", () => {
    const out = mergePlayerVoteMapsForCatchUp(
      { Alice: "A", Bob: "A" },
      { Alice: "B", Bob: "A" }
    );
    assert.equal(out.Alice, "B");
    assert.equal(out.Bob, "A");
    assert.equal(Object.keys(out).filter((k) => k === "Alice").length, 1);
  });

  it("optimiste local-only conservé si absent du remote", () => {
    const out = mergePlayerVoteMapsForCatchUp(
      { Alice: "B", Bob: "A" },
      { Bob: "A" }
    );
    assert.equal(out.Alice, "B");
    assert.equal(out.Bob, "A");
  });

  it("hôte/invité : local stale A + remote B → convergence B", () => {
    // Bug terrain : ancien `{...remote,...local}` gardait A.
    const hostLocal = { Alice: "A" };
    const remoteAfterChange = { Alice: "B" };
    const wrongOld = { ...remoteAfterChange, ...hostLocal };
    assert.equal(wrongOld.Alice, "A", "preuve de l'ancien anti-pattern");
    const fixed = mergePlayerVoteMapsForCatchUp(hostLocal, remoteAfterChange);
    assert.equal(fixed.Alice, "B");
  });

  it("compteur votants inchangé A→B", () => {
    const before = mergePlayerVoteMapsForCatchUp({}, { Alice: "A", Bob: "B" });
    const after = mergePlayerVoteMapsForCatchUp(before, {
      Alice: "B",
      Bob: "B",
    });
    assert.equal(Object.keys(before).length, 2);
    assert.equal(Object.keys(after).length, 2);
    assert.equal(after.Alice, "B");
  });

  it("pas de double clé name+uid après normalisation conceptuelle", () => {
    // Catch-up travaille sur maps déjà normalisées display-name.
    const out = mergePlayerVoteMapsForCatchUp(
      { Alice: "A" },
      { Alice: "B" }
    );
    assert.deepEqual(Object.keys(out), ["Alice"]);
    assert.equal(out.Alice, "B");
  });
});

describe("mergeDilemmaPatchState - wire votes replace", () => {
  const mergeReadyUid = (a, b) => ({ ...(a?.ready || {}), ...(b?.ready || {}) });
  const mergeVotes = (cur, inc) => ({
    ...(cur?.votes || {}),
    ...(inc?.votes || {}),
  });

  it("patch votes-only UID remplace A par B", () => {
    const cur = { phase: "voting", votes: { "uid-alice": "A" }, ready: {} };
    const inc = { votes: { "uid-alice": "B" } };
    const out = mergeDilemmaPatchState(cur, inc, "Alice", {
      mergeReadyUid,
      mergeVotes,
    });
    assert.equal(out.votes["uid-alice"], "B");
    assert.equal(Object.keys(out.votes).length, 1);
  });
});

describe("commitDilemmaVote - stale catch après B", () => {
  it("tentative A tardive ne restaure pas après B", () => {
    let map = {};
    const applyA = computeOptimisticMapEntryApply({
      map,
      key: "Alice",
      value: "A",
    });
    map = applyA.nextMap;
    const applyB = computeOptimisticMapEntryApply({
      map,
      key: "Alice",
      value: "B",
    });
    map = applyB.nextMap;
    // B confirmé ; catch tardif de A
    const rolled = rollbackOptimisticMapEntry({
      currentMap: map,
      key: "Alice",
      hadPreviousValue: applyA.hadPreviousValue,
      previousValue: applyA.previousValue,
      optimisticValue: applyA.optimisticValue,
      attemptId: 1,
      currentAttemptId: 2,
    });
    assert.equal(rolled.applied, false);
    assert.equal(map.Alice, "B");
  });

  it("phase reveal : pas de rollback incompatible", () => {
    assert.equal(
      canRollbackOptimisticSubmission(
        { phase: "voting", roundIdx: 0 },
        { phase: "reveal", roundIdx: 0 }
      ),
      false
    );
  });
});

describe("SYN-VOTE-ROLLBACK-01B - contrats source Dilemma", () => {
  it("mergeDilemmaGameLocal utilise mergePlayerVoteMapsForCatchUp", () => {
    const src = read("js/core/gameSync.js");
    const start = src.indexOf("function mergeDilemmaGameLocal");
    const block = src.slice(start, start + 2000);
    assert.match(block, /mergePlayerVoteMapsForCatchUp\s*\(\s*localVotes\s*,\s*remoteVotes\s*\)/);
    assert.equal(block.includes("{ ...remoteVotes, ...localVotes }"), false);
  });

  it("UI Dilemma : myVote dérivé de la session après succès", () => {
    const src = read("js/games/dilemma.js");
    const start = src.indexOf("async function submitVote");
    const block = src.slice(start, start + 1200);
    assert.match(block, /await commitDilemmaVote/);
    assert.match(block, /getDilemmaSession\(\)\.votes/);
    assert.match(block, /Catch terminal UI/);
  });

  it("handlers terminaux cluster consomment le rejet", () => {
    const cases = [
      ["js/games/speedVote.js", "commitSpeedVoteVote", "Catch terminal UI"],
      ["js/games/dilemma.js", "commitDilemmaVote", "Catch terminal UI"],
      ["js/games/wrongAnswer.js", "commitWrongAnswerAnswer", "Catch terminal UI"],
      ["js/games/wrongAnswer.js", "commitWrongAnswerVote", "Catch terminal UI"],
      ["js/games/traitre.js", "commitTraitreVote", "Catch terminal UI"],
      ["js/games/tierNightLive.js", "commitTierNightLiveVote", "Catch terminal UI"],
    ];
    for (const [file, commit, marker] of cases) {
      const src = read(file);
      const idx = src.indexOf(`await ${commit}`);
      assert.ok(idx >= 0, `${commit} missing in ${file}`);
      const window = src.slice(Math.max(0, idx - 200), idx + 500);
      assert.match(window, /try\s*\{/);
      assert.match(window, /catch\s*\(/);
      assert.match(window, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
