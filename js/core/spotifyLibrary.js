import { getSpotifyAccessToken, clearSpotifyToken, refreshSpotifyAccessToken } from "./spotifyAuth.js";

export function normalizeSpotifyTrack(item) {
  const t = item?.track;
  if (!t?.id || t.is_local) return null;
  return {
    spotifyId: t.id,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    albumImage: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || null,
    popularity: t.popularity ?? 0,
  };
}

export async function fetchAllLikedTracks(accessToken) {
  const out = [];
  let url = "https://api.spotify.com/v1/me/tracks?limit=50";
  let token = accessToken;

  while (url) {
    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      token = await refreshSpotifyAccessToken();
      if (!token) {
        clearSpotifyToken();
        throw new Error("SPOTIFY_TOKEN_EXPIRED");
      }
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }

    if (!res.ok) {
      throw new Error("SPOTIFY_API_FAILURE");
    }

    const data = await res.json();
    for (const item of data.items || []) {
      const track = normalizeSpotifyTrack(item);
      if (track) out.push(track);
    }
    url = data.next;
  }

  return out;
}

export async function loadLocalSpotifyLibrary() {
  const token = await getSpotifyAccessToken();
  if (!token) throw new Error("SPOTIFY_DISCONNECTED");
  const tracks = await fetchAllLikedTracks(token);
  if (!tracks.length) throw new Error("NO_LIKED_SONGS");
  return tracks;
}
