/**
 * Routage I-08 : détecte une contribution joueur simple (une seule map uid)
 * et renvoie { game, kind, value } pour contribute_game_session_player.
 * Ne fait confiance à aucun UID client : l'appelant doit vérifier que la
 * seule clé de map === auth.uid().
 */

const STATE_KEY_TO_GAME = {
  hotTake: "hottake",
  dilemma: "dilemma",
  speedVote: "speedvote",
  clutch: "clutch",
  wrongAnswer: "wronganswer",
  traitre: "traitre",
  playlistGuess: "playlistguess",
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
 * @param {object} stateMerge
 * @param {string|null} localUid
 * @returns {{ game: string, kind: string, value: unknown } | null}
 */
export function detectPlayerContribution(stateMerge, localUid) {
  if (!stateMerge || typeof stateMerge !== "object" || !localUid) return null;
  const topKeys = Object.keys(stateMerge);
  if (topKeys.length !== 1) return null;

  const stateKey = topKeys[0];
  const game = STATE_KEY_TO_GAME[stateKey];
  if (!game) return null;

  const blob = stateMerge[stateKey];
  if (!blob || typeof blob !== "object") return null;
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
