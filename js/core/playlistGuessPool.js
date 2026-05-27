import { PLAYLIST_GUESS_POPULARITY_MAX } from "../../data/playlistGuess.js";

export function mergeSongsPool(librariesByUid = {}, { maxPopularity = PLAYLIST_GUESS_POPULARITY_MAX } = {}) {
  const seen = new Set();
  const pool = [];

  Object.entries(librariesByUid).forEach(([ownerUserId, tracks]) => {
    if (!Array.isArray(tracks)) return;
    tracks.forEach((track) => {
      if (!track?.spotifyId) return;
      if ((track.popularity ?? 0) > maxPopularity) return;
      if (seen.has(track.spotifyId)) return;
      seen.add(track.spotifyId);
      pool.push({ ...track, ownerUserId });
    });
  });

  return pool;
}

export function validateMergedPool(pool, playerCount, roundCount) {
  const unique = new Set(pool.map((t) => t.spotifyId));
  if (unique.size < playerCount) {
    return { ok: false, error: "DUPLICATE_POOL_ONLY" };
  }
  if (pool.length < roundCount) {
    return { ok: false, error: "INSUFFICIENT_POOL" };
  }
  return { ok: true, uniqueCount: unique.size };
}
