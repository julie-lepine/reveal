/**
 * Routage I-08 : détecte une contribution joueur simple (une seule map uid)
 * et renvoie { game, kind, value } pour contribute_game_session_player.
 * Ne fait confiance à aucun UID client : l'appelant doit vérifier que la
 * seule clé de map === auth.uid().
 *
 * BUG-TIERNIGHT-PREP-GUEST-01 : `tierNightPrep` (ready + poolInvalidateRequestId)
 * est un blob distinct de `tierNight` — détection dédiée.
 */

const STATE_KEY_TO_GAME = {
  hotTake: "hottake",
  dilemma: "dilemma",
  speedVote: "speedvote",
  clutch: "clutch",
  wrongAnswer: "wronganswer",
  traitre: "traitre",
  trivia: "trivia",
  consensus: "consensus",
  truthMeter: "truthmeter",
  guessLie: "guesslie",
  tierNight: "tiernight",
  tierNightLive: "tiernightlive",
};

const MAP_TO_KIND = {
  ready: "ready",
  votes: "vote",
  answers: "answer",
  taps: "tap",
  dealAcks: "deal_ack",
  submissions: "submission",
  placements: "placement",
  finished: "finished",
};

/**
 * Contributions invité prep série → state.tierNightPrep (pas tierNight).
 * Ready : valeur RPC `{ ready: bool, expectedSetupEpoch: number }` (anti-stale).
 * @param {object} blob
 * @param {string} localUid
 * @returns {{ game: string, kind: string, value: unknown } | null}
 */
function detectTierNightPrepContribution(blob, localUid) {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) return null;
  const mapKeys = Object.keys(blob);

  const epochKey = mapKeys.includes("expectedSetupEpoch")
    ? "expectedSetupEpoch"
    : mapKeys.includes("setupEpoch")
      ? "setupEpoch"
      : null;

  // Forme canonique : { ready: { [uid]: bool }, expectedSetupEpoch }
  if (
    mapKeys.includes("ready") &&
    epochKey &&
    mapKeys.length === 2
  ) {
    const map = blob.ready;
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    const uids = Object.keys(map);
    if (uids.length !== 1 || uids[0] !== localUid) return null;
    const readyVal = map[localUid];
    if (typeof readyVal !== "boolean") return null;
    const expectedSetupEpoch = Number(blob[epochKey]);
    if (!Number.isFinite(expectedSetupEpoch) || expectedSetupEpoch < 0) return null;
    return {
      game: "tiernight",
      kind: "ready",
      value: { ready: readyVal, expectedSetupEpoch },
    };
  }

  // Forme compacte : { ready: { [uid]: { ready, expectedSetupEpoch } } }
  if (mapKeys.length === 1 && mapKeys[0] === "ready") {
    const map = blob.ready;
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    const uids = Object.keys(map);
    if (uids.length !== 1 || uids[0] !== localUid) return null;
    const entry = map[localUid];
    // Booléen nu sans epoch → refusé (course stale après bump hôte)
    if (typeof entry === "boolean") return null;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    if (typeof entry.ready !== "boolean") return null;
    const expectedSetupEpoch = Number(
      entry.expectedSetupEpoch ?? entry.setupEpoch
    );
    if (!Number.isFinite(expectedSetupEpoch) || expectedSetupEpoch < 0) return null;
    return {
      game: "tiernight",
      kind: "ready",
      value: { ready: entry.ready, expectedSetupEpoch },
    };
  }

  if (mapKeys.length === 1 && mapKeys[0] === "poolInvalidateRequest") {
    const req = blob.poolInvalidateRequest;
    if (!req || typeof req !== "object" || Array.isArray(req)) return null;
    const requestId =
      req.requestId != null ? String(req.requestId).trim() : "";
    const customEntryId =
      req.customEntryId != null ? String(req.customEntryId).trim() : "";
    if (!requestId || !customEntryId) return null;
    return {
      game: "tiernight",
      kind: "pool_invalidate_request",
      value: { requestId, customEntryId },
    };
  }

  // Ancienne forme string seule → refusée (spam sans preuve de custom)
  if (mapKeys.length === 1 && mapKeys[0] === "poolInvalidateRequestId") {
    return null;
  }

  return null;
}

/**
 * @param {object} stateMerge
 * @param {string|null} localUid
 * @returns {{ game: string, kind: string, value: unknown } | null}
 */
export function detectPlayerContribution(stateMerge, localUid) {
  if (!stateMerge || typeof stateMerge !== "object" || !localUid) return null;
  const topKeys = Object.keys(stateMerge);
  if (topKeys.length !== 1) return null;

  const stateKey = topKeys[0];
  const blob = stateMerge[stateKey];
  if (!blob || typeof blob !== "object") return null;

  if (stateKey === "tierNightPrep") {
    return detectTierNightPrepContribution(blob, localUid);
  }

  const game = STATE_KEY_TO_GAME[stateKey];
  if (!game) return null;

  const mapKeys = Object.keys(blob);
  if (mapKeys.length !== 1) return null;

  const mapName = mapKeys[0];
  const kind = MAP_TO_KIND[mapName];
  if (!kind) return null;

  const map = blob[mapName];
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const uids = Object.keys(map);
  if (uids.length !== 1) return null;
  if (uids[0] !== localUid) return null;

  return { game, kind, value: map[localUid] };
}

export function stateKeyToGameId(stateKey) {
  return STATE_KEY_TO_GAME[stateKey] || null;
}

/**
 * Contribution ciblée roulette : `{ chatRoulette: { reactionsByUid: { [uid]: value } } }`.
 * @param {object} stateMerge
 * @param {string|null} localUid
 * @returns {{ reaction: string|null } | null}
 */
export function detectChatRouletteReactionContribution(stateMerge, localUid) {
  if (!stateMerge || typeof stateMerge !== "object" || !localUid) return null;
  const topKeys = Object.keys(stateMerge);
  if (topKeys.length !== 1 || topKeys[0] !== "chatRoulette") return null;
  const inc = stateMerge.chatRoulette;
  if (!inc || typeof inc !== "object") return null;
  const mapKeys = Object.keys(inc);
  if (mapKeys.length !== 1 || mapKeys[0] !== "reactionsByUid") return null;
  const map = inc.reactionsByUid;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const uids = Object.keys(map);
  if (uids.length !== 1 || uids[0] !== localUid) return null;
  const value = map[localUid];
  if (value != null && typeof value !== "string") return null;
  return { reaction: value == null ? null : value };
}
