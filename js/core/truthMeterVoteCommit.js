/**
 * BUG-TRUTHMETER-01A — apply / compensation vote local (sans écraser les votes distants).
 */

/**
 * @param {{ votes?: Record<string, number> }} session
 * @param {string} localName
 * @param {number} choice
 */
export function computeTruthMeterVoteApply(session, localName, choice) {
  const previousVotes = { ...(session?.votes || {}) };
  const hadPrevious = Object.prototype.hasOwnProperty.call(previousVotes, localName);
  const previousLocalVote = hadPrevious ? previousVotes[localName] : undefined;
  const nextVotes = { ...previousVotes, [localName]: choice };
  return { previousVotes, nextVotes, hadPrevious, previousLocalVote };
}

/**
 * Compense uniquement la clé du joueur local (conserve les autres votes du store courant).
 * @param {{ votes?: Record<string, number> }} session
 * @param {string} localName
 * @param {{ hadPrevious: boolean, previousLocalVote?: number }} snapshot
 */
export function compensateTruthMeterLocalVote(session, localName, snapshot) {
  const votes = { ...(session?.votes || {}) };
  if (snapshot?.hadPrevious && Number.isFinite(snapshot.previousLocalVote)) {
    votes[localName] = snapshot.previousLocalVote;
  } else {
    delete votes[localName];
  }
  return votes;
}

/** @param {unknown} err */
export function isTruthMeterVoteNetworkUncertainty(err) {
  if (!err) return false;
  const name = String(err?.name || "");
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    name === "AbortError" ||
    name === "TypeError" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("synchronisation trop longue")
  );
}

/**
 * Vote distant confirmé pour le joueur local (ignore toute intention UI).
 * @param {{ votes?: Record<string, number> }} session
 * @param {string|null|undefined} localName
 * @returns {number|null}
 */
export function resolveConfirmedTruthMeterVote(session, localName) {
  if (!localName) return null;
  const v = session?.votes?.[localName];
  return Number.isFinite(v) ? v : null;
}

/**
 * Compte les votes confirmés parmi les votants attendus (clés déjà normalisées).
 * Ne lit aucun draft UI.
 */
export function countConfirmedVoterVotesInMap(votes = {}, voterNames = []) {
  return voterNames.filter((n) => Number.isFinite(votes?.[n])).length;
}

/** TruthMeter MP : remplace matchScores locaux dès que le serveur a scoré (ou nouveau run). */
export function isTruthMeterRemoteScoreAuthority(local, remote) {
  if (!remote) return false;
  if (remote.runId && local?.runId && remote.runId !== local.runId) return true;
  if (Boolean(remote.roundScored)) return true;
  if (remote.phase === "reveal") return true;
  return false;
}

function mergeMatchScoresMax(local = {}, remote = {}) {
  const merged = { ...local };
  Object.entries(remote).forEach(([name, pts]) => {
    if (typeof pts === "number" && Number.isFinite(pts)) {
      merged[name] = Math.max(merged[name] || 0, pts);
    }
  });
  return merged;
}

/** Hydratation matchScores TruthMeter — remplacement si autorité serveur, sinon max. */
export function hydrateTruthMeterMatchScores(local, remote) {
  if (isTruthMeterRemoteScoreAuthority(local, remote)) {
    return { ...(remote?.matchScores || {}) };
  }
  return mergeMatchScoresMax(local?.matchScores || {}, remote?.matchScores || {});
}
