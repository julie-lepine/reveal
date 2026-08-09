/**
 * AUDIT-001 — merge matchScores (hydrate full vs patch partiel).
 * Module pur (pas de deps UI / Supabase) pour tests Node.
 */

/** Fusion locale des matchScores (sync multijoueur, max par joueur). */
export function mergeMatchScoresLocal(local = {}, remote = {}) {
  const merged = { ...local };
  Object.entries(remote).forEach(([name, pts]) => {
    if (typeof pts === "number" && Number.isFinite(pts)) {
      merged[name] = Math.max(merged[name] || 0, pts);
    }
  });
  return merged;
}

function matchScoresMapSize(scores) {
  return Object.keys(scores && typeof scores === "object" ? scores : {}).length;
}

/**
 * Hydrate full session : faut-il remplacer les matchScores locaux par le remote ?
 *
 * Clear autoritatif :
 * - shell prep / fin de partie : `lobbyStarted === false` + remote vide
 * - lancement play : `lobbyStarted === true`, index 0, pas encore scoréd,
 *   remote vide, local encore non vide
 *
 * Ne pas utiliser sur un patch partiel où `matchScores` peut être omis.
 */
export function shouldReplaceMatchScoresOnFullHydrate(localGame = {}, remoteGame = {}) {
  if (!remoteGame || typeof remoteGame !== "object") return false;
  if (matchScoresMapSize(remoteGame.matchScores) > 0) return false;

  if (remoteGame.lobbyStarted === false) return true;

  if (remoteGame.lobbyStarted === true) {
    const idx = Number(remoteGame.takeIdx ?? remoteGame.roundIdx ?? 0);
    if (!Number.isFinite(idx) || idx !== 0) return false;
    if (remoteGame.takeScored || remoteGame.roundScored) return false;
    return matchScoresMapSize(localGame?.matchScores) > 0;
  }

  return false;
}

/**
 * Merge matchScores pour hydrate full (HotTake, SpeedVote, Clutch, WrongAnswer, Dilemma).
 */
export function mergeMatchScoresForFullHydrate(localGame = {}, remoteGame = {}) {
  if (shouldReplaceMatchScoresOnFullHydrate(localGame, remoteGame)) {
    return { ...(remoteGame.matchScores || {}) };
  }
  return mergeMatchScoresLocal(
    localGame.matchScores || {},
    remoteGame.matchScores || {}
  );
}

/**
 * Patch wire (clés uid) : omit = conserver ; `{}` explicite = clear ; sinon max.
 */
export function mergeMatchScoresPatchUid(cur = {}, inc, { keyPresent } = {}) {
  if (!keyPresent) {
    const out = {};
    Object.entries(cur || {}).forEach(([uid, val]) => {
      if (typeof val === "number" && Number.isFinite(val)) out[uid] = val;
    });
    return out;
  }
  if (!inc || typeof inc !== "object" || Object.keys(inc).length === 0) {
    return {};
  }
  const merged = { ...(cur || {}) };
  Object.entries(inc).forEach(([uid, val]) => {
    if (typeof val !== "number" || !Number.isFinite(val)) return;
    merged[uid] = Math.max(merged[uid] || 0, val);
  });
  return merged;
}
