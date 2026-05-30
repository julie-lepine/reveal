// VibeCheck - une chanson tirée au sort, les joueurs votent à qui elle correspond le mieux.
import { PLAYLIST_GUESS_SONGS } from "./vibecheckSongs.js";

export const PLAYLIST_GUESS_MIN_PLAYERS = 3;

// Conservé comme jeton de manche (`voteEndsAt`) pour la détection de nouvelle manche.
// Il n'y a plus de compte à rebours visible.
export const PLAYLIST_GUESS_TIMER_SEC = 30;

export const PLAYLIST_GUESS_POINTS = {
  // Le(s) joueur(s) le(s) plus voté(s)
  MOST_VOTED: 15,
  // Tout joueur ayant voté pour un joueur le plus voté (majorité)
  MAJORITY: 10,
};

export const PLAYLIST_GUESS_ROUND_PRESETS = [3, 5, 8];
export const PLAYLIST_GUESS_ROUND_DEFAULT = 5;

export { PLAYLIST_GUESS_SONGS };
