/** Snapshot taps avant/après apply local (rollback si sync échoue). */
export function computeClutchTapApply(session, localName, tap) {
  const previousTaps = { ...(session.taps || {}) };
  const existing = previousTaps[localName];
  if (existing?.ms != null) {
    return {
      alreadyTapped: true,
      previousTaps,
      nextTaps: previousTaps,
      tap: existing,
    };
  }
  const nextTaps = { ...previousTaps, [localName]: tap };
  return { alreadyTapped: false, previousTaps, nextTaps, tap };
}
