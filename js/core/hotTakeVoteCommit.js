/** Snapshot votes Hot Take avant/après apply local (rollback si sync échoue). */
export function computeHotTakeVoteApply(session, localName, choice) {
  const previousVotes = { ...(session.votes || {}) };
  const nextVotes = { ...previousVotes, [localName]: choice };
  return { previousVotes, nextVotes };
}
