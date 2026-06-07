import {
  TRAITRE_MIN_PLAYERS,
  TRAITRE_POINTS,
  pickRandomTraitrePair,
  getTraitrePairById,
} from "../../data/traitre.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import {
  addScore,
  bumpPlayerStat,
  getLocalDisplayName,
  getState,
  saveStatePatch,
} from "./state.js";
import {
  allMembersReady,
  isGameSyncActive,
  isLobbyHost,
  syncTraitreSession,
  traitreToRemote,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { hostDistributeTraitreRoles } from "./traitrePrivate.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { normalizeKeyedVotes } from "./sessionMerge.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    phase: null,
    pairId: null,
    impostorName: null,
    isLocalImpostor: false,
    speakRound: 1,
    speakerIndex: 0,
    alive: [],
    eliminated: [],
    votes: {},
    revotePending: false,
    revoteCount: 0,
    voteSurvivals: 0,
    dealAcks: {},
    lastVoteSnapshot: null,
    lastEliminated: null,
    impostorRevealed: false,
    winner: null,
    scoresApplied: false,
    lastRound: null,
  };
}

export function defaultTraitrePrepSession() {
  return defaultSession();
}

export function getTraitreSession() {
  return getState().traitreGame || defaultSession();
}

export function isLocalTraitreHost() {
  return isLobbyHost();
}

export function getTraitrePair(session = getTraitreSession()) {
  return getTraitrePairById(session.pairId);
}

export function getMyTraitreWord(session = getTraitreSession()) {
  const pair = getTraitrePair(session);
  if (!pair) return null;
  const me = getLocalDisplayName();
  const amImpostor =
    session.isLocalImpostor === true || (session.impostorName && session.impostorName === me);
  return amImpostor ? pair.b : pair.a;
}

export function getTraitreSpeakOrder(session = getTraitreSession()) {
  const alive = [...(session.alive || [])];
  if (!alive.length) return [];
  const offset = ((session.speakRound || 1) - 1) % alive.length;
  return [...alive.slice(offset), ...alive.slice(0, offset)];
}

export function getCurrentTraitreSpeaker(session = getTraitreSession()) {
  const order = getTraitreSpeakOrder(session);
  const idx = session.speakerIndex || 0;
  return order[idx] ?? null;
}

export function allTraitreReady() {
  const session = getTraitreSession();
  if (isGameSyncActive()) {
    return allMembersReady(traitreToRemote(session).ready || {});
  }
  return getActivePlayerNames().every((name) => session.ready?.[name]);
}

export async function setTraitreReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getTraitreSession,
    saveLocal: (session) => saveStatePatch({ traitreGame: session }),
    stateKey: "traitre",
    gameId: "traitre",
    screen: "traitre-prep",
  });
}

export function simulateTraitreReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    void setTraitreReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export function validateTraitreLaunch() {
  const count = getActivePlayerNames().length;
  return {
    ok: count >= TRAITRE_MIN_PLAYERS,
    count,
    min: TRAITRE_MIN_PLAYERS,
  };
}

export function createStartedTraitreSession() {
  const names = getActivePlayerNames();
  const check = validateTraitreLaunch();
  if (!check.ok) return { ok: false, ...check };
  const pair = pickRandomTraitrePair();
  const impostorName = names[Math.floor(Math.random() * names.length)];
  const localName = getLocalDisplayName();
  return {
    ok: true,
    session: {
      ...defaultSession(),
      lobbyStarted: true,
      phase: "deal",
      pairId: pair.id,
      impostorName,
      isLocalImpostor: impostorName === localName,
      alive: [...names],
      eliminated: [],
      speakRound: 1,
      speakerIndex: 0,
      voteSurvivals: 0,
      dealAcks: {},
      votes: {},
    },
  };
}

export async function markTraitreLobbyStarted() {
  const started = createStartedTraitreSession();
  if (!started.ok) return started;
  const next = started.session;
  const result = await launchGameWithSync({
    screen: "traitre",
    gameId: "traitre",
    mode: "push",
    applyLocal: () => saveStatePatch({ traitreGame: next }),
    getRemoteState: () => ({ traitre: traitreToRemote(next) }),
  });
  if (result.ok !== false && isGameSyncActive() && isLobbyHost()) {
    try {
      await hostDistributeTraitreRoles(next.pairId, next.impostorName, next.alive);
    } catch (e) {
      console.warn("REVEAL traitre roles:", e);
    }
  }
  return { ...result, ok: result.ok !== false, session: next };
}

export async function commitTraitrePlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "traitre",
    screen: "traitre",
    stateKey: "traitre",
    getSession: getTraitreSession,
    saveLocal: (session) => saveStatePatch({ traitreGame: session }),
    toRemote: traitreToRemote,
    patchOpts,
  });
}

export async function commitTraitreDealAck() {
  const localName = getLocalDisplayName();
  const session = getTraitreSession();
  const dealAcks = { ...(session.dealAcks || {}), [localName]: true };
  saveStatePatch({ traitreGame: { ...session, dealAcks } });
  if (!isGameSyncActive()) return dealAcks;
  const { userIdForName } = await import("./gameSync.js");
  const uid = userIdForName(localName) || localName;
  await patchGameStateWithFeedback({ traitre: { dealAcks: { [uid]: true } } });
  return dealAcks;
}

export async function commitTraitreVote(targetName) {
  const localName = getLocalDisplayName();
  const session = getTraitreSession();
  if (session.phase !== "vote") return null;
  const votes = { ...(session.votes || {}), [localName]: targetName };
  saveStatePatch({ traitreGame: { ...session, votes } });
  if (!isGameSyncActive()) return targetName;
  const { userIdForName } = await import("./gameSync.js");
  const uid = userIdForName(localName) || localName;
  const targetUid = userIdForName(targetName) || targetName;
  await patchGameStateWithFeedback({ traitre: { votes: { [uid]: targetUid } } });
  return targetName;
}

export function allTraitreDealAcksIn(session = getTraitreSession()) {
  const alive = session.alive || getActivePlayerNames();
  return alive.length > 0 && alive.every((name) => session.dealAcks?.[name]);
}

/** Votes indexés par pseudo (sync multijoueur peut envoyer des UUID). */
export function normalizeTraitreVotes(votes = {}, alive = []) {
  return normalizeKeyedVotes(votes, alive, (key) => {
    const mapped = nameForUserId(key);
    if (mapped) return mapped;
    return alive.includes(String(key)) ? String(key) : null;
  });
}

export function countTraitreVotesCast(votes = {}, alive = []) {
  const normalized = normalizeTraitreVotes(votes, alive);
  return alive.filter((name) => normalized[name]).length;
}

export function allTraitreVotesIn(session = getTraitreSession()) {
  const alive = session.alive || [];
  const votes = normalizeTraitreVotes(session.votes || {}, alive);
  return alive.length > 0 && alive.every((name) => votes[name] != null && votes[name] !== "");
}

export function countTraitreVotes(votes = {}, alive = []) {
  const normalized = normalizeTraitreVotes(votes, alive);
  const counts = {};
  alive.forEach((name) => {
    const target = normalized[name];
    if (!target || !alive.includes(target)) return;
    counts[target] = (counts[target] || 0) + 1;
  });
  let max = 0;
  Object.values(counts).forEach((n) => {
    if (n > max) max = n;
  });
  const leaders = Object.entries(counts)
    .filter(([, n]) => n === max && max > 0)
    .map(([name]) => name);
  return {
    counts,
    leaders,
    maxVotes: max,
    isTie: leaders.length > 1,
  };
}

export function buildTraitreEliminationPatch(session, eliminatedName) {
  const impostor = session.impostorName;
  const newEliminated = [...(session.eliminated || []), eliminatedName];
  const newAlive = (session.alive || []).filter((n) => n !== eliminatedName);
  const base = {
    eliminated: newEliminated,
    alive: newAlive,
    lastEliminated: eliminatedName,
    votes: {},
    revotePending: false,
    revoteCount: 0,
  };

  if (eliminatedName === impostor) {
    return {
      ...base,
      phase: "final",
      impostorRevealed: true,
      winner: "civilians",
      lastVoteSnapshot: normalizeTraitreVotes(session.votes || {}, session.alive || []),
    };
  }

  if (newAlive.length <= 2 && newAlive.includes(impostor)) {
    return {
      ...base,
      phase: "final",
      impostorRevealed: true,
      winner: "traitre",
    };
  }

  return {
    ...base,
    phase: "speak",
    speakRound: (session.speakRound || 1) + 1,
    speakerIndex: 0,
    voteSurvivals: (session.voteSurvivals || 0) + 1,
  };
}

export function buildTraitreTieRevotePatch(session) {
  return {
    phase: "vote",
    votes: {},
    revotePending: true,
    revoteCount: (session.revoteCount || 0) + 1,
  };
}

export function awardTraitreGame(session = getTraitreSession()) {
  if (session.scoresApplied) return session;

  const impostor = session.impostorName;
  const deltas = {};
  const summary = {
    winner: session.winner,
    impostorName: impostor,
    voteSurvivals: session.voteSurvivals || 0,
    deltas: {},
  };

  if (session.winner === "traitre" && impostor) {
    const pts =
      TRAITRE_POINTS.INTRUS_WIN +
      (session.voteSurvivals || 0) * TRAITRE_POINTS.INTRUS_SURVIVE_VOTE;
    deltas[impostor] = pts;
    addScore(impostor, pts);
    bumpPlayerStat(impostor, "traitreWins", 1);
  } else if (session.winner === "civilians" && impostor) {
    deltas[impostor] = 0;
    const voters = [
      ...(session.alive || []),
      ...(session.eliminated || []),
      session.lastEliminated,
    ].filter(Boolean);
    const snapshot = normalizeTraitreVotes(session.lastVoteSnapshot || {}, [
      ...new Set(voters),
    ]);
    Object.entries(snapshot).forEach(([name, target]) => {
      if (name === impostor || target !== impostor) return;
      deltas[name] = TRAITRE_POINTS.CIVIL_CORRECT_VOTE;
      addScore(name, TRAITRE_POINTS.CIVIL_CORRECT_VOTE);
      bumpPlayerStat(name, "traitreDetections", 1);
    });
  }

  summary.deltas = deltas;
  const updated = {
    ...session,
    scoresApplied: true,
    lastRound: summary,
  };
  saveStatePatch({ traitreGame: updated });
  return updated;
}

export function getTraitreEntryScreen() {
  const session = getTraitreSession();
  return session.lobbyStarted ? "traitre" : "traitre-prep";
}

export function getTraitreVoteTargets(session = getTraitreSession()) {
  return getActivePlayers().filter((p) => (session.alive || []).includes(p.name));
}

export function simulateTraitreVotes(localTarget, session = getTraitreSession()) {
  const result = {};
  const local = getLocalDisplayName();
  const alive = session.alive || [];
  result[local] = localTarget;
  alive.forEach((name) => {
    if (name === local) return;
    const pool = alive.filter((n) => n !== name);
    if (!pool.length) return;
    result[name] = pool[Math.floor(Math.random() * pool.length)];
  });
  return result;
}
