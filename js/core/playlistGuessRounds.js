export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {Array<{ userId: string, name: string }>} players
 * @param {Array} pool - pistes avec ownerUserId
 * @param {string[]} usedTrackIds
 */
export function generateWhoLikesRound(players, pool, usedTrackIds = []) {
  const eligible = pool.filter((s) => !usedTrackIds.includes(s.spotifyId));
  if (!eligible.length) return null;

  const trackEntry = eligible[Math.floor(Math.random() * eligible.length)];
  const owner = players.find((p) => p.userId === trackEntry.ownerUserId);
  if (!owner) return null;

  const choices = shuffleArray(
    players.map((p) => ({ playerId: p.userId, label: p.name }))
  );

  return {
    track: {
      spotifyId: trackEntry.spotifyId,
      title: trackEntry.title,
      artist: trackEntry.artist,
      albumImage: trackEntry.albumImage,
    },
    ownerPlayerId: owner.userId,
    ownerName: owner.name,
    choices,
  };
}

export function buildPlaylistGuessDeck(players, pool, roundCount) {
  const deck = [];
  const used = [];
  for (let i = 0; i < roundCount; i++) {
    const round = generateWhoLikesRound(players, pool, used);
    if (!round) break;
    used.push(round.track.spotifyId);
    deck.push(round);
  }
  return { deck, usedTrackIds: used };
}
