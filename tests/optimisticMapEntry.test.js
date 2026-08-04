/**
 * SYN-VOTE-ROLLBACK-01 - helper map entry + guards run/phase.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "../js/core/optimisticMapEntry.js";

describe("optimisticMapEntry - apply", () => {
  it("clé absente : ajoute sans hadPrevious", () => {
    const out = computeOptimisticMapEntryApply({
      map: { Bob: "A" },
      key: "Alice",
      value: "B",
    });
    assert.equal(out.hadPreviousValue, false);
    assert.equal(out.previousValue, undefined);
    assert.equal(out.optimisticValue, "B");
    assert.deepEqual(out.nextMap, { Bob: "A", Alice: "B" });
  });

  it("clé présente : conserve previousValue (y compris falsy)", () => {
    const out = computeOptimisticMapEntryApply({
      map: { Alice: 0, Bob: "x" },
      key: "Alice",
      value: 1,
    });
    assert.equal(out.hadPreviousValue, true);
    assert.equal(out.previousValue, 0);
    assert.equal(out.nextMap.Alice, 1);
    assert.equal(out.nextMap.Bob, "x");
  });

  it("map null → map vide sûre", () => {
    const out = computeOptimisticMapEntryApply({ map: null, key: "A", value: "v" });
    assert.deepEqual(out.nextMap, { A: "v" });
    assert.equal(out.hadPreviousValue, false);
  });
});

describe("optimisticMapEntry - rollback", () => {
  it("clé absente avant : delete réel (pas undefined)", () => {
    const apply = computeOptimisticMapEntryApply({ map: {}, key: "A", value: "v" });
    const rolled = rollbackOptimisticMapEntry({
      currentMap: apply.nextMap,
      key: "A",
      hadPreviousValue: apply.hadPreviousValue,
      previousValue: apply.previousValue,
      optimisticValue: apply.optimisticValue,
    });
    assert.equal(rolled.applied, true);
    assert.equal(Object.prototype.hasOwnProperty.call(rolled.map, "A"), false);
  });

  it("clé présente avant : restaure uniquement cette entrée", () => {
    const apply = computeOptimisticMapEntryApply({
      map: { A: "old", B: "keep" },
      key: "A",
      value: "new",
    });
    const mid = { ...apply.nextMap, B: "keep", C: "added" };
    const rolled = rollbackOptimisticMapEntry({
      currentMap: mid,
      key: "A",
      hadPreviousValue: true,
      previousValue: "old",
      optimisticValue: "new",
    });
    assert.equal(rolled.applied, true);
    assert.deepEqual(rolled.map, { A: "old", B: "keep", C: "added" });
  });

  it("autre joueur ajouté entre apply et rollback : préservé", () => {
    const apply = computeOptimisticMapEntryApply({ map: {}, key: "A", value: "v" });
    const rolled = rollbackOptimisticMapEntry({
      currentMap: { A: "v", B: "other" },
      key: "A",
      hadPreviousValue: false,
      optimisticValue: "v",
    });
    assert.equal(rolled.applied, true);
    assert.deepEqual(rolled.map, { B: "other" });
  });

  it("autre joueur modifié entre apply et rollback : préservé", () => {
    const apply = computeOptimisticMapEntryApply({
      map: { A: "old", B: "b0" },
      key: "A",
      value: "new",
    });
    const rolled = rollbackOptimisticMapEntry({
      currentMap: { A: "new", B: "b1" },
      key: "A",
      hadPreviousValue: true,
      previousValue: "old",
      optimisticValue: "new",
    });
    assert.equal(rolled.applied, true);
    assert.equal(rolled.map.A, "old");
    assert.equal(rolled.map.B, "b1");
  });

  it("valeur remplacée : no-op", () => {
    const rolled = rollbackOptimisticMapEntry({
      currentMap: { A: "newer" },
      key: "A",
      hadPreviousValue: false,
      optimisticValue: "old",
    });
    assert.equal(rolled.applied, false);
    assert.equal(rolled.reason, "value_replaced");
    assert.deepEqual(rolled.map, { A: "newer" });
  });

  it("attemptId obsolète : no-op", () => {
    const rolled = rollbackOptimisticMapEntry({
      currentMap: { A: "v" },
      key: "A",
      hadPreviousValue: false,
      optimisticValue: "v",
      attemptId: 1,
      currentAttemptId: 2,
    });
    assert.equal(rolled.applied, false);
    assert.equal(rolled.reason, "stale_attempt");
  });

  it("falsy previous 0 / false / '' restaurés", () => {
    for (const prev of [0, false, ""]) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: { A: "x" },
        key: "A",
        hadPreviousValue: true,
        previousValue: prev,
        optimisticValue: "x",
      });
      assert.equal(rolled.applied, true);
      assert.equal(rolled.map.A, prev);
    }
  });

  it("rollback deux fois : idempotent", () => {
    const first = rollbackOptimisticMapEntry({
      currentMap: { A: "v" },
      key: "A",
      hadPreviousValue: false,
      optimisticValue: "v",
    });
    const second = rollbackOptimisticMapEntry({
      currentMap: first.map,
      key: "A",
      hadPreviousValue: false,
      optimisticValue: "v",
    });
    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.reason, "key_absent");
  });
});

describe("canRollbackOptimisticSubmission", () => {
  it("refuse runId différent", () => {
    assert.equal(
      canRollbackOptimisticSubmission({ runId: "r1", phase: "voting" }, {
        runId: "r2",
        phase: "voting",
      }),
      false
    );
  });

  it("refuse phase différente", () => {
    assert.equal(
      canRollbackOptimisticSubmission({ phase: "voting", roundIdx: 0 }, {
        phase: "reveal",
        roundIdx: 0,
      }),
      false
    );
  });

  it("accepte même run/phase/round", () => {
    assert.equal(
      canRollbackOptimisticSubmission(
        { runId: "r1", phase: "voting", roundIdx: 2 },
        { runId: "r1", phase: "voting", roundIdx: 2 }
      ),
      true
    );
  });
});
