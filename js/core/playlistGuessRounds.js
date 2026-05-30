export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Construit le deck VibeCheck : `roundCount` chansons tirées au hasard du pool.
 * Chaque manche = une chanson ; les joueurs votent à qui elle correspond le mieux.
 * @param {Array<{ id: string, title: string, artist: string, albumImage: string|null }>} pool
 * @param {number} roundCount
 */
export function buildPlaylistGuessDeck(pool, roundCount) {
  const deck = shuffleArray(pool)
    .slice(0, roundCount)
    .map((song) => ({
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        albumImage: song.albumImage || null,
      },
    }));
  return { deck };
}
