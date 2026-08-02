/**
 * BUG-TIERNIGHT-05 — merge des votes Rank live (TierNight-only).
 * Ne modifie pas isNewSpeedVoteVoteRound (contrat SpeedVote).
 */
import { isNewSpeedVoteVoteRound, mergeSpeedVotePhase } from "./sessionMerge.js";

/**
 * Reset distant explicite pour placements / structure de partie.
 * - partie terminée
 * - nouvelle partie Live : voting, round 0, sans placements
 *
 * Attention : ne pas l'utiliser seul pour wipe des votes pendant la 1re manche
 * du même run (course hôte : vote optimiste vs remote encore vide).
 */
export function isTierNightLiveRemoteReset(remote = {}) {
  const remotePlacements = remote.placements || {};
  const remoteHasPlacements = Object.keys(remotePlacements).length > 0;
  return (
    (!remote.lobbyStarted && remote.finished) ||
    (Boolean(remote.lobbyStarted) &&
      !remote.finished &&
      remote.phase === "voting" &&
      (remote.roundIdx ?? 0) === 0 &&
      !remoteHasPlacements)
  );
}

/**
 * Différence certaine de run : les deux IDs doivent être présents.
 * `undefined !== "new"` seul n'est pas traité comme nouveau run.
 */
export function tierNightLiveRunIdsDiffer(cur = {}, inc = {}) {
  const a = cur?.runId ?? null;
  const b = inc?.runId ?? null;
  return Boolean(a && b && a !== b);
}

/**
 * Faut-il abandonner les votes de `cur` au profit de ceux de `inc` ?
 *
 * 1. les deux runId présents et différents
 * 2. local sans runId + remote avec runId (hydratation / pré-migration)
 * 3. remote terminé (select / fin) → votes remote (souvent {})
 * 4. nouvelle manche SpeedVote (roundIdx / voteEndsAt) — helper partagé inchangé
 *
 * Ne passe PAS par isTierNightLiveRemoteReset pour les votes : ce signal
 * reste vrai toute la 1re manche tant qu'il n'y a pas de placements, et
 * effacerait le vote optimiste local si le remote est encore vide.
 */
export function isNewTierNightLiveVoteRound(cur, inc) {
  if (!inc) return false;
  if (tierNightLiveRunIdsDiffer(cur, inc)) return true;
  if (!(cur?.runId) && inc?.runId) return true;
  if (!inc.lobbyStarted && inc.finished) return true;
  return isNewSpeedVoteVoteRound(cur, inc);
}

/**
 * Hydratation client : nouveau run/reset → votes distants seuls ;
 * même manche → local-first (vote optimiste avant echo serveur).
 */
export function mergeTierNightLiveVotesForHydrate(local, remote) {
  if (isNewTierNightLiveVoteRound(local, remote)) {
    return { ...(remote?.votes || {}) };
  }
  return { ...(remote?.votes || {}), ...(local?.votes || {}) };
}

/**
 * Patch serveur (mergeRemote*) : nouveau run/reset → votes entrants seuls ;
 * même manche → incoming-first (contribution atomique gagne).
 */
export function mergeTierNightLiveVotesForPatch(cur, inc) {
  if (isNewTierNightLiveVoteRound(cur, inc)) {
    return { ...(inc?.votes || {}) };
  }
  return { ...(cur?.votes || {}), ...(inc?.votes || {}) };
}

/**
 * Fusion des champs session Live (hors mapping pseudo — fait dans gameSync).
 */
export function mergeTierNightLiveGameFields(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const remotePlacements = remote.placements || {};
  const remoteHasPlacements = Object.keys(remotePlacements).length > 0;
  const remoteReset = isTierNightLiveRemoteReset(remote);
  const playerRoster =
    Array.isArray(remote.playerRoster) && remote.playerRoster.length
      ? remote.playerRoster
      : local.playerRoster || null;
  return {
    ...local,
    ...remote,
    playerRoster,
    phase: mergeSpeedVotePhase(local, remote),
    votes: mergeTierNightLiveVotesForHydrate(local, remote),
    placements: remoteReset
      ? remotePlacements
      : remoteHasPlacements
        ? { ...(local.placements || {}), ...remotePlacements }
        : local.placements || {},
  };
}
