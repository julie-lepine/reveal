import {
  PLAYLIST_GUESS_DEV_FALLBACK,
  PLAYLIST_GUESS_MIN_PLAYERS,
  PLAYLIST_GUESS_ROUND_DEFAULT,
  PLAYLIST_GUESS_TIMER_SEC,
  PLAYLIST_GUESS_ROUND_PRESETS,
} from "../../data/playlistGuess.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { isSpotifyConnected } from "./spotifyAuth.js";
import { loadLocalSpotifyLibrary } from "./spotifyLibrary.js";
import { mergeSongsPool, validateMergedPool } from "./playlistGuessPool.js";
import { buildPlaylistGuessDeck } from "./playlistGuessRounds.js";
import {
  isGameSyncActive,
  isLobbyHost,
  syncPlaylistGuessSession,
  pushGameSession,
  playlistGuessToRemote,
  allMembersReady,
} from "./gameSync.js";

function defaultSession() {
  return {
    /** Ready map keyed by playerId (userId) to avoid name collisions. */
    ready: {},
    spotifyByUid: {},
    librariesByUid: {},
    lobbyStarted: false,
    roundCount: PLAYLIST_GUESS_ROUND_DEFAULT,
    deck: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
    usedTrackIds: [],
    connectError: null,
  };
}

export function getLocalParticipantId() {
  const uid = getSupabaseUserId();
  if (uid) return uid;
  const local = getLobbyParticipants().find((p) => p.isLocal);
  return local?.userId || getLocalDisplayName();
}

export function lobbyPlayersWithIds() {
  return getLobbyParticipants().map((p) => ({
    userId: p.userId || p.name,
    name: p.name,
    color: p.color,
    emoji: p.emoji,
    isLocal: Boolean(p.isLocal),
  }));
}

function activePlayerIds() {
  return lobbyPlayersWithIds().map((p) => p.userId);
}

export function getPlaylistGuessSession() {
  return getState().playlistGuessGame || defaultSession();
}

export function defaultPlaylistGuessPrepSession() {
  return defaultSession();
}

export function isLocalPlaylistGuessHost() {
  const local = getLobbyParticipants().find((p) => p.isLocal);
  return local?.isHost !== false;
}

export function canUseDevTrackFallback() {
  return !isGameSyncActive() && !isSpotifyConnected();
}

export async function buildDevLibraryForLocal() {
  const id = getLocalParticipantId();
  const tracks = PLAYLIST_GUESS_DEV_FALLBACK.map((t, i) => ({
    ...t,
    spotifyId: `${t.spotifyId}-${id}-${i}`,
  }));
  return tracks;
}

export function getPlaylistGuessPrepSummary() {
  const session = getPlaylistGuessSession();
  const players = lobbyPlayersWithIds();
  const pool = mergeSongsPool(session.librariesByUid);
  const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
  const validation = validateMergedPool(pool, players.length, roundCount);
  const connectedCount = players.filter((p) => {
    const meta = session.spotifyByUid?.[p.userId];
    return meta?.connected && (session.librariesByUid?.[p.userId]?.length || 0) > 0;
  }).length;

  return {
    poolSize: pool.length,
    roundCount,
    effective: validation.ok ? roundCount : Math.min(roundCount, pool.length),
    connectedCount,
    playerCount: players.length,
    minPlayersMet: players.length >= PLAYLIST_GUESS_MIN_PLAYERS,
    minPlayers: PLAYLIST_GUESS_MIN_PLAYERS,
    validation,
    durationLabel: `~${Math.ceil((roundCount * PLAYLIST_GUESS_TIMER_SEC) / 60)} min`,
  };
}

export async function connectAndSyncSpotifyLibrary() {
  const uid = getLocalParticipantId();
  let tracks;
  let errorCode = null;

  try {
    if (canUseDevTrackFallback()) {
      tracks = await buildDevLibraryForLocal();
    } else {
      tracks = await loadLocalSpotifyLibrary();
    }
  } catch (e) {
    errorCode = e.message || "SPOTIFY_API_FAILURE";
    const session = getPlaylistGuessSession();
    await syncPlaylistGuessSession({
      ...session,
      spotifyByUid: {
        ...(session.spotifyByUid || {}),
        [uid]: { connected: false, trackCount: 0, errorCode },
      },
      connectError: errorCode,
    });
    throw e;
  }

  const session = getPlaylistGuessSession();
  const next = {
    ...session,
    librariesByUid: { ...(session.librariesByUid || {}), [uid]: tracks },
    spotifyByUid: {
      ...(session.spotifyByUid || {}),
      [uid]: { connected: true, trackCount: tracks.length, errorCode: null },
    },
    connectError: null,
  };
  await syncPlaylistGuessSession(next);
  return tracks;
}

export async function disconnectLocalSpotify() {
  const { clearSpotifyToken } = await import("./spotifyAuth.js");
  clearSpotifyToken();
  const uid = getLocalParticipantId();
  const session = getPlaylistGuessSession();
  const libraries = { ...(session.librariesByUid || {}) };
  const spotify = { ...(session.spotifyByUid || {}) };
  delete libraries[uid];
  delete spotify[uid];
  await syncPlaylistGuessSession({
    ...session,
    librariesByUid: libraries,
    spotifyByUid: spotify,
    ready: { ...session.ready, [uid]: false },
  });
}

export function isLocalSpotifyReady() {
  const uid = getLocalParticipantId();
  const session = getPlaylistGuessSession();
  return (session.librariesByUid?.[uid]?.length || 0) > 0;
}

export async function setPlaylistGuessRoundCount(count) {
  const session = getPlaylistGuessSession();
  await syncPlaylistGuessSession({ ...session, roundCount: count, deck: null });
}

export async function setPlaylistGuessReady(playerId, ready) {
  const session = getPlaylistGuessSession();
  await syncPlaylistGuessSession({
    ...session,
    ready: { ...session.ready, [playerId]: ready },
  });
}

export async function toggleLocalPlaylistGuessReady() {
  const id = getLocalParticipantId();
  const session = getPlaylistGuessSession();
  if (!session.ready[id] && !isLocalSpotifyReady()) {
    return { ok: false, error: "SPOTIFY_REQUIRED" };
  }
  await setPlaylistGuessReady(id, !session.ready[id]);
  return { ok: true };
}

export function allPlaylistGuessReady() {
  const session = getPlaylistGuessSession();
  if (isGameSyncActive()) {
    const remote = playlistGuessToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  const ids = activePlayerIds();
  return ids.length > 0 && ids.every((id) => session.ready[id]);
}

function votingPayloadForRound(roundIdx, deck) {
  const endsAt = new Date(Date.now() + PLAYLIST_GUESS_TIMER_SEC * 1000).toISOString();
  return {
    roundIdx,
    phase: "voting",
    votes: {},
    voteEndsAt: endsAt,
    roundScored: false,
  };
}

/** Mode solo sans Spotify : bibliothèques fictives pour chaque joueur actif. */
export async function ensureDevLibrariesForSolo() {
  if (!canUseDevTrackFallback()) return;
  const session = getPlaylistGuessSession();
  const libraries = { ...(session.librariesByUid || {}) };
  const spotify = { ...(session.spotifyByUid || {}) };
  let changed = false;

  for (const p of lobbyPlayersWithIds()) {
    if ((libraries[p.userId]?.length || 0) > 0) continue;
    libraries[p.userId] = PLAYLIST_GUESS_DEV_FALLBACK.map((t, i) => ({
      ...t,
      spotifyId: `${t.spotifyId}-${p.userId}-${i}`,
    }));
    spotify[p.userId] = {
      connected: true,
      trackCount: libraries[p.userId].length,
      errorCode: null,
    };
    changed = true;
  }

  if (changed) {
    await syncPlaylistGuessSession({
      ...session,
      librariesByUid: libraries,
      spotifyByUid: spotify,
    });
  }
}

export async function markPlaylistGuessLobbyStarted() {
  if (canUseDevTrackFallback()) {
    await ensureDevLibrariesForSolo();
  }
  const players = lobbyPlayersWithIds();
  if (players.length < PLAYLIST_GUESS_MIN_PLAYERS) {
    throw new Error("NOT_ENOUGH_PLAYERS");
  }
  const session = getPlaylistGuessSession();
  const pool = mergeSongsPool(session.librariesByUid);
  const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
  const validation = validateMergedPool(pool, players.length, roundCount);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const { deck, usedTrackIds } = buildPlaylistGuessDeck(players, pool, roundCount);
  if (!deck.length) throw new Error("INSUFFICIENT_POOL");

  const next = {
    ...session,
    lobbyStarted: true,
    deck,
    usedTrackIds,
    ...votingPayloadForRound(0, deck),
  };
  saveStatePatch({ playlistGuessGame: next });

  if (isGameSyncActive() && isLobbyHost()) {
    await pushGameSession({
      screen: "playlistguess",
      gameId: "playlistguess",
      state: { playlistGuess: playlistGuessToRemote(next) },
    });
  }
}

export function getPlaylistGuessDeck() {
  const session = getPlaylistGuessSession();
  return session.deck || [];
}

export function getCurrentPlaylistGuessRound() {
  const deck = getPlaylistGuessDeck();
  const idx = getPlaylistGuessSession().roundIdx ?? 0;
  return deck[idx] ?? null;
}

export function getPlaylistGuessEntryScreen() {
  const session = getPlaylistGuessSession();
  if (!session.lobbyStarted) return "playlistguess-prep";
  return "playlistguess";
}

export async function startPlaylistGuessRound(roundIdx) {
  const deck = getPlaylistGuessDeck();
  const next = {
    ...getPlaylistGuessSession(),
    ...votingPayloadForRound(roundIdx, deck),
  };
  await syncPlaylistGuessSession(next);
  return next;
}

export async function commitPlaylistGuessPlay(patch) {
  const session = { ...getPlaylistGuessSession(), ...patch };
  await syncPlaylistGuessSession(session);
  return session;
}

export function allPlaylistGuessVotesIn() {
  const session = getPlaylistGuessSession();
  const round = getCurrentPlaylistGuessRound();
  if (!round) return false;
  const votesByUid = session.votes || {};
  const voterUids = lobbyPlayersWithIds()
    .map((p) => p.userId)
    .filter((uid) => uid !== round.ownerPlayerId);
  return (
    voterUids.length > 0 &&
    voterUids.every((uid) => votesByUid[uid] != null && votesByUid[uid] !== "")
  );
}

export function simulatePlaylistGuessVotes(round, localPick) {
  const votes = {};
  const local = getLocalDisplayName();
  const localUid = getLocalParticipantId();
  const choices = round.choices.map((c) => c.playerId);

  lobbyPlayersWithIds()
    .forEach((p) => {
    if (p.userId === round.ownerPlayerId) return;
    if (p.userId === localUid) {
      if (localPick) votes[p.userId] = localPick;
      return;
    }
    const pick = choices[Math.floor(Math.random() * choices.length)];
    votes[p.userId] = pick;
  });
  if (localPick && localUid !== round.ownerPlayerId) votes[localUid] = localPick;
  return votes;
}

export function nameForPlayerId(playerId) {
  const p = lobbyPlayersWithIds().find((x) => x.userId === playerId);
  return p?.name || playerId;
}

export {
  PLAYLIST_GUESS_MIN_PLAYERS,
  PLAYLIST_GUESS_TIMER_SEC,
  PLAYLIST_GUESS_ROUND_PRESETS,
  PLAYLIST_GUESS_ROUND_DEFAULT,
};
