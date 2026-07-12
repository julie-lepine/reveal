import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyStatePatchShallow,
  snapshotStatePatch,
} from "../js/core/restartGameRollback.js";

describe("restartGameRollback", () => {
  it("restaure l'état précédent après un échec simulé", () => {
    const state = {
      hotTakeGame: { phase: "reveal", takeIdx: 4, lobbyStarted: true },
      other: 1,
    };
    const patch = { hotTakeGame: { phase: null, takeIdx: 0, lobbyStarted: false } };
    const previous = snapshotStatePatch(state, Object.keys(patch));
    const afterApply = applyStatePatchShallow(state, patch);
    assert.notDeepEqual(afterApply.hotTakeGame, state.hotTakeGame);

    const afterRollback = applyStatePatchShallow(afterApply, previous);
    assert.deepEqual(afterRollback.hotTakeGame, state.hotTakeGame);
    assert.equal(afterRollback.other, 1);
  });

  it("conserve le nouvel état en cas de succès (sans rollback)", () => {
    const state = { dilemmaGame: { roundIdx: 3, phase: "results" } };
    const patch = { dilemmaGame: { roundIdx: 0, phase: null, ready: {} } };
    const afterApply = applyStatePatchShallow(state, patch);
    assert.deepEqual(afterApply.dilemmaGame, patch.dilemmaGame);
  });

  it("rollback multi-clés TierNight", () => {
    const state = {
      tierNightTopicId: "movies",
      tierNightMode: "live",
      tierNightModifier: "chaos",
      tierNightGame: { runId: "old", recaps: [{ id: 1 }] },
      tierNightLiveGame: { runId: "old", phase: "vote" },
    };
    const patch = {
      tierNightTopicId: null,
      tierNightMode: "consensus",
      tierNightModifier: "normal",
      tierNightGame: { runId: "new", recaps: [] },
      tierNightLiveGame: { runId: "new", phase: null },
    };
    const previous = snapshotStatePatch(state, Object.keys(patch));
    const afterApply = applyStatePatchShallow(state, patch);
    const afterRollback = applyStatePatchShallow(afterApply, previous);

    assert.equal(afterRollback.tierNightTopicId, "movies");
    assert.equal(afterRollback.tierNightMode, "live");
    assert.equal(afterRollback.tierNightModifier, "chaos");
    assert.deepEqual(afterRollback.tierNightGame, state.tierNightGame);
    assert.deepEqual(afterRollback.tierNightLiveGame, state.tierNightLiveGame);
  });
});
