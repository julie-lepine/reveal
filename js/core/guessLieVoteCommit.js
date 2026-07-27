/**
 * Contrats vote Guess Lie (commit MP) — purs, testables hors session.
 */

/** MP : pas d'écriture locale avant confirmation RPC. */
export function shouldDeferGuessLieVoteLocalWrite(isSyncActive) {
  return Boolean(isSyncActive);
}

/**
 * Rollback optimiste si le vote local est encore celui du commit en échec.
 * Ne touche pas une valeur distante arrivée entre-temps (current !== pendingPick).
 */
export function rollbackGuessLieOptimisticVote(
  votes,
  localName,
  pendingPick,
  { previousPick = null, hadPrevious = false } = {}
) {
  const current = votes?.[localName] ?? null;
  if (current !== pendingPick) return votes;
  const next = { ...(votes || {}) };
  if (hadPrevious) next[localName] = previousPick;
  else delete next[localName];
  return next;
}
