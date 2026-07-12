/** Snapshot shallow des clés d'un patch state (rollback M-11). */
export function snapshotStatePatch(state, patchKeys) {
  const previous = {};
  for (const key of patchKeys) {
    previous[key] = state[key];
  }
  return previous;
}

/** Applique un patch shallow (miroir de saveStatePatch, sans persistance). */
export function applyStatePatchShallow(state, patch) {
  return { ...state, ...patch };
}
