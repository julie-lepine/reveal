/** Apply vote Hot Take (tests purs). Le rollback runtime utilise rollbackOptimisticMapEntry. */
import { computeOptimisticMapEntryApply } from "./optimisticMapEntry.js";

export function computeHotTakeVoteApply(session, localName, choice) {
  const apply = computeOptimisticMapEntryApply({
    map: session?.votes,
    key: localName,
    value: choice,
  });
  const previousVotes = { ...(session?.votes || {}) };
  return {
    previousVotes,
    nextVotes: apply.nextMap,
    hadPreviousValue: apply.hadPreviousValue,
    previousValue: apply.previousValue,
    optimisticValue: apply.optimisticValue,
  };
}
