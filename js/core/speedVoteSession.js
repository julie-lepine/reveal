import {
  SPEED_VOTE_THEMES,
  SPEED_VOTE_CATALOG_ID,
  SPEED_VOTE_ROUND_PRESETS,
  SPEED_VOTE_TIMER_SEC,
  SPEED_VOTE_MODIFIERS,
  getSpeedVoteThemeQuestions,
} from "../../data/speedVote.js";
import {
  SPEED_VOTE_ROUND_ALL,
  estimateSpeedVoteDuration,
  resolveEffectiveRoundCount,
} from "./speedVoteDuration.js";
import { getActivePlayerNames } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  syncSpeedVoteSession,
  allMembersReady,
  speedVoteToRemote,
  patchGameState,
  userIdForName,
} from "./gameSync.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    selectedThemeId: SPEED_VOTE_CATALOG_ID,
    roundCount: 5,
    deck: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
    modifier: "normal",
  };
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRoundModifier() {
  const r = Math.random();
  if (r < 0.18) return "double";
  if (r < 0.32) return "hidden";
  return "normal";
}

export function getSpeedVoteSession() {
  return getState().speedVoteGame || defaultSession();
}

export function defaultSpeedVotePrepSession() {
  return defaultSession();
}

export function getSpeedVoteModifier(session = getSpeedVoteSession()) {
  return SPEED_VOTE_MODIFIERS[session.modifier] || SPEED_VOTE_MODIFIERS.normal;
}

export function isLocalSpeedVoteHost() {
  return isLobbyHost();
}

export function getSpeedVotePoolSize() {
  const session = getSpeedVoteSession();
  const themeId = session.selectedThemeId || SPEED_VOTE_CATALOG_ID;
  return getSpeedVoteThemeQuestions(themeId).length;
}

export function getSpeedVoteRoundCount() {
  return getSpeedVoteSession().roundCount ?? 5;
}

export async function setSpeedVoteTheme(themeId) {
  const session = getSpeedVoteSession();
  await syncSpeedVoteSession({ ...session, selectedThemeId: themeId, deck: null });
}

export async function setSpeedVoteRoundCount(count) {
  const session = getSpeedVoteSession();
  await syncSpeedVoteSession({ ...session, roundCount: count, deck: null });
}

export function getSpeedVotePrepSummary() {
  const poolSize = getSpeedVotePoolSize();
  const requested = getSpeedVoteRoundCount();
  const effective = resolveEffectiveRoundCount(requested, poolSize);
  const duration = estimateSpeedVoteDuration(effective);
  return {
    poolSize,
    requested,
    effective,
    durationLabel: duration.label,
    capped: requested !== SPEED_VOTE_ROUND_ALL && requested > poolSize,
  };
}

export function buildSpeedVoteDeck() {
  const session = getSpeedVoteSession();
  const themeId = session.selectedThemeId || SPEED_VOTE_CATALOG_ID;
  const bank = getSpeedVoteThemeQuestions(themeId);
  const effective = resolveEffectiveRoundCount(session.roundCount ?? 5, bank.length);
  const deck = shuffleArray(bank).slice(0, effective);
  const next = { ...session, deck };
  saveStatePatch({ speedVoteGame: next });
  return deck;
}

export function getSpeedVoteQuestions() {
  const session = getSpeedVoteSession();
  if (session.deck?.length) return session.deck;
  return buildSpeedVoteDeck();
}

/** Tous les joueurs du lobby, soi compris (auto-vote autorisé). */
export function getVoteTargets() {
  return getLobbyParticipants();
}

function votingPayloadForRound(roundIdx, deck) {
  const question = deck[roundIdx] || "-";
  const endsAt = new Date(Date.now() + SPEED_VOTE_TIMER_SEC * 1000).toISOString();
  return {
    roundIdx,
    phase: "voting",
    votes: {},
    voteEndsAt: endsAt,
    roundScored: false,
    modifier: pickRoundModifier(),
    currentQuestion: question,
  };
}

export async function markSpeedVoteLobbyStarted() {
  const deck = buildSpeedVoteDeck();
  const next = {
    ...getSpeedVoteSession(),
    lobbyStarted: true,
    ...votingPayloadForRound(0, deck),
  };
  return launchGameWithSync({
    screen: "speedvote",
    gameId: "speedvote",
    mode: "push",
    applyLocal: () => saveStatePatch({ speedVoteGame: next }),
    getRemoteState: () => ({ speedVote: speedVoteToRemote(next) }),
  });
}

export async function startSpeedVoteRound(roundIdx) {
  const deck = getSpeedVoteQuestions();
  const next = {
    ...getSpeedVoteSession(),
    ...votingPayloadForRound(roundIdx, deck),
  };
  await syncSpeedVoteSession(next);
  return next;
}

export async function resetSpeedVoteReady() {
  const session = getSpeedVoteSession();
  await syncSpeedVoteSession({ ...session, ready: {} });
}

export async function setSpeedVoteReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getSpeedVoteSession,
    saveLocal: (session) => saveStatePatch({ speedVoteGame: session }),
    stateKey: "speedVote",
    gameId: "speedvote",
    screen: "speedvote-prep",
  });
}

export async function toggleLocalSpeedVoteReady() {
  const name = getLocalDisplayName();
  const session = getSpeedVoteSession();
  await setSpeedVoteReady(name, !session.ready[name]);
}

export function allSpeedVoteReady() {
  const session = getSpeedVoteSession();
  if (isGameSyncActive()) {
    const remote = speedVoteToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export function simulateSpeedVoteReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    setSpeedVoteReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export async function commitSpeedVotePlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "speedvote",
    stateKey: "speedVote",
    getSession: getSpeedVoteSession,
    saveLocal: (session) => saveStatePatch({ speedVoteGame: session }),
    toRemote: speedVoteToRemote,
    patchOpts,
  });
}

/** MP : envoie uniquement le vote local. */
export async function commitSpeedVoteVote(choice) {
  const localName = getLocalDisplayName();
  const session = getSpeedVoteSession();
  if (session.votes?.[localName] != null && session.votes[localName] !== "") {
    return session.votes[localName];
  }
  const votes = { ...(session.votes || {}), [localName]: choice };
  saveStatePatch({ speedVoteGame: { ...session, votes } });
  if (!isGameSyncActive()) return choice;
  const uid = userIdForName(localName) || localName;
  await patchGameState({ speedVote: { votes: { [uid]: choice } } });
  return choice;
}

export function allSpeedVoteVotesIn() {
  const votes = getSpeedVoteSession().votes || {};
  const names = getActivePlayerNames();
  return names.length > 0 && names.every((name) => votes[name] != null && votes[name] !== "");
}

export function getSpeedVoteEntryScreen() {
  const session = getSpeedVoteSession();
  if (!session.lobbyStarted) return "speedvote-prep";
  return "speedvote";
}

export function simulateSpeedVoteLobbyVotes(localTarget) {
  const result = {};
  const local = getLocalDisplayName();
  const targets = getVoteTargets().map((p) => p.name);
  result[local] = localTarget;

  const allNames = getActivePlayerNames();
  getActivePlayerNames().forEach((name) => {
    if (name === local) return;
    const pool = targets.length ? targets : allNames;
    if (!pool.length) return;
    const bias = Math.random() < 0.4 ? localTarget : null;
    result[name] = bias || pool[Math.floor(Math.random() * pool.length)];
  });
  return result;
}

export function countSpeedVoteResults(votes) {
  const counts = {};
  Object.values(votes).forEach((target) => {
    if (!target) return;
    counts[target] = (counts[target] || 0) + 1;
  });
  let max = 0;
  Object.values(counts).forEach((n) => {
    if (n > max) max = n;
  });
  const leaders = Object.entries(counts)
    .filter(([, n]) => n === max && max > 0)
    .map(([name]) => name);
  return { counts, leaders, maxVotes: max, totalVotes: Object.keys(votes).length };
}

export {
  SPEED_VOTE_THEMES,
  SPEED_VOTE_ROUND_PRESETS,
  SPEED_VOTE_ROUND_ALL,
  SPEED_VOTE_CATALOG_ID,
  SPEED_VOTE_TIMER_SEC,
};
