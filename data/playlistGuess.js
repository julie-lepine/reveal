/** VibeCheck - likes Spotify, devine le propriétaire */

export const PLAYLIST_GUESS_MIN_PLAYERS = 3;

export const PLAYLIST_GUESS_TIMER_SEC = 30;

export const PLAYLIST_GUESS_POINTS = {
  CORRECT_GUESS: 50,
  OWNER_STEALTH: 50,
};

export const PLAYLIST_GUESS_POPULARITY_MAX = 90;

export const PLAYLIST_GUESS_ROUND_PRESETS = [3, 5, 8];
export const PLAYLIST_GUESS_ROUND_DEFAULT = 5;

/** Titres de secours - solo local sans Spotify uniquement */
export const PLAYLIST_GUESS_DEV_FALLBACK = [
  {
    spotifyId: "dev-1",
    title: "Mr. Brightside",
    artist: "The Killers",
    albumImage: null,
    popularity: 85,
  },
  {
    spotifyId: "dev-2",
    title: "Blinding Lights",
    artist: "The Weeknd",
    albumImage: null,
    popularity: 88,
  },
  {
    spotifyId: "dev-3",
    title: "Get Lucky",
    artist: "Daft Punk",
    albumImage: null,
    popularity: 82,
  },
  {
    spotifyId: "dev-4",
    title: "Levitating",
    artist: "Dua Lipa",
    albumImage: null,
    popularity: 80,
  },
  {
    spotifyId: "dev-5",
    title: "Shape of You",
    artist: "Ed Sheeran",
    albumImage: null,
    popularity: 75,
  },
  {
    spotifyId: "dev-6",
    title: "Uptown Funk",
    artist: "Mark Ronson",
    albumImage: null,
    popularity: 78,
  },
];
