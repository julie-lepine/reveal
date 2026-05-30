import {
  PLAYLIST_GUESS_MIN_PLAYERS,
  PLAYLIST_GUESS_ROUND_DEFAULT,
  PLAYLIST_GUESS_TIMER_SEC,
  PLAYLIST_GUESS_ROUND_PRESETS,
  PLAYLIST_GUESS_SONGS,
} from "../../data/playlistGuess.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
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
    lobbyStarted: false,
    roundCount: PLAYLIST_GUESS_ROUND_DEFAULT,
    deck: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
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

/** Tous les joueurs du lobby sont des cibles de vote (auto-vote autorisé). */
export function getVoteTargets() {
  return lobbyPlayersWithIds();
}

export function getPlaylistGuessPrepSummary() {
  const players = lobbyPlayersWithIds();
  const session = getPlaylistGuessSession();
  const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
  const poolSize = PLAYLIST_GUESS_SONGS.length;
  const effective = Math.min(roundCount, poolSize);
  return {
    poolSize,
    roundCount,
    effective,
    playerCount: players.length,
    minPlayersMet: players.length >= PLAYLIST_GUESS_MIN_PLAYERS,
    minPlayers: PLAYLIST_GUESS_MIN_PLAYERS,
    durationLabel: `~${Math.ceil((effective * PLAYLIST_GUESS_TIMER_SEC) / 60)} min`,
  };
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

export function simulatePlaylistGuessReady(onUpdate) {
  const local = getLocalParticipantId();
  const pool = lobbyPlayersWithIds().filter((p) => p.userId !== local);
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    setPlaylistGuessReady(pool[i].userId, true);
    i += 1;
    onUpdate?.();
  }, 500);
  return () => clearInterval(id);
}

function votingPayloadForRound(roundIdx) {
  const endsAt = new Date(Date.now() + PLAYLIST_GUESS_TIMER_SEC * 1000).toISOString();
  return {
    roundIdx,
    phase: "voting",
    votes: {},
    voteEndsAt: endsAt,
    roundScored: false,
  };
}

export async function markPlaylistGuessLobbyStarted() {
  const players = lobbyPlayersWithIds();
  if (players.length < PLAYLIST_GUESS_MIN_PLAYERS) {
    throw new Error("NOT_ENOUGH_PLAYERS");
  }
  const session = getPlaylistGuessSession();
  const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
  const { deck } = buildPlaylistGuessDeck(PLAYLIST_GUESS_SONGS, roundCount);
  if (!deck.length) throw new Error("INSUFFICIENT_POOL");

  const next = {
    ...session,
    lobbyStarted: true,
    deck,
    ...votingPayloadForRound(0),
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
  const next = {
    ...getPlaylistGuessSession(),
    ...votingPayloadForRound(roundIdx),
  };
  await syncPlaylistGuessSession(next);
  return next;
}

export async function commitPlaylistGuessPlay(patch) {
  const session = { ...getPlaylistGuessSession(), ...patch };
  await syncPlaylistGuessSession(session);
  return session;
}

/** Tous les joueurs du lobby ont voté (auto-vote autorisé, personne n'est exclu). */
export function allPlaylistGuessVotesIn() {
  const session = getPlaylistGuessSession();
  const votesByUid = session.votes || {};
  const voterUids = lobbyPlayersWithIds().map((p) => p.userId);
  return (
    voterUids.length > 0 &&
    voterUids.every((uid) => votesByUid[uid] != null && votesByUid[uid] !== "")
  );
}

export function simulatePlaylistGuessVotes(_round, localPick) {
  const votes = {};
  const localUid = getLocalParticipantId();
  const targets = lobbyPlayersWithIds().map((p) => p.userId);

  lobbyPlayersWithIds().forEach((p) => {
    if (p.userId === localUid) {
      if (localPick) votes[p.userId] = localPick;
      return;
    }
    const pick = targets[Math.floor(Math.random() * targets.length)];
    votes[p.userId] = pick;
  });
  if (localPick) votes[localUid] = localPick;
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
