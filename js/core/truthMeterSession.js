import {
  TRUTH_METER_AFFIRMATION_MIN,
  TRUTH_METER_AFFIRMATION_MAX,
} from "../../data/truthMeter.js";
import { checkHotTakeModeration } from "./hotTakeSession.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  syncTruthMeterSession,
  allMembersReady,
  truthMeterToRemote,
  patchGameState,
  userIdForName,
  normalizePlayerVotesMap,
} from "./gameSync.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    authorOrder: [],
    roundIdx: 0,
    phase: null,
    affirmation: null,
    authorEstimate: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
    matchScores: {},
    lastRound: null,
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

export function defaultTruthMeterPrepSession() {
  return defaultSession();
}

export function getTruthMeterSession() {
  return getState().truthMeterGame || defaultSession();
}

export function isLocalTruthMeterHost() {
  return isLobbyHost();
}

export function truthLabel(pct) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  if (n <= 15) return "Faux";
  if (n <= 40) return "Très douteux";
  if (n <= 55) return "Possible";
  if (n <= 80) return "Probable";
  return "Vrai";
}

export function getCurrentAuthor() {
  const session = getTruthMeterSession();
  const order = session.authorOrder || [];
  return order[session.roundIdx] || null;
}

export function getVoterNames() {
  const author = getCurrentAuthor();
  return getActivePlayerNames().filter((n) => n !== author);
}

/** Votes des juges uniquement - l'auteur ne participe pas au verdict du groupe. */
export function filterVoterVotes(votes = {}, author = getCurrentAuthor()) {
  const out = {};
  Object.entries(votes || {}).forEach(([name, v]) => {
    if (author && name === author) return;
    if (Number.isFinite(v)) out[name] = v;
  });
  return out;
}

export function computeGroupAverage(votes = {}, author = null) {
  const pool = author ? filterVoterVotes(votes, author) : votes;
  const values = Object.values(pool).filter((v) => Number.isFinite(v));
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function computeRoundMetrics(votes, authorEstimate, author = getCurrentAuthor()) {
  const voterVotes = filterVoterVotes(votes, author);
  const groupAvg = computeGroupAverage(voterVotes);
  const est = Number.isFinite(authorEstimate) ? authorEstimate : 0;
  const gap = Math.abs(est - groupAvg);
  const values = Object.values(voterVotes).filter((v) => Number.isFinite(v));
  let variance = 0;
  if (values.length > 1) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    variance = Math.round(
      values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
    );
  }
  return { groupAvg, gap, authorEstimate: est, variance };
}

export function validateAffirmation(text) {
  const trimmed = text.trim();
  if (trimmed.length < TRUTH_METER_AFFIRMATION_MIN) {
    return { ok: false, error: `Minimum ${TRUTH_METER_AFFIRMATION_MIN} caractères.` };
  }
  if (trimmed.length > TRUTH_METER_AFFIRMATION_MAX) {
    return { ok: false, error: `Maximum ${TRUTH_METER_AFFIRMATION_MAX} caractères.` };
  }
  const mod = checkHotTakeModeration(trimmed);
  if (mod.blocked) return { ok: false, error: mod.message };
  return { ok: true, text: trimmed };
}

export async function setTruthMeterReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getTruthMeterSession,
    saveLocal: (session) => saveStatePatch({ truthMeterGame: session }),
    stateKey: "truthMeter",
    gameId: "truthmeter",
    screen: "truthmeter-prep",
  });
}

export async function toggleLocalTruthMeterReady() {
  const name = getLocalDisplayName();
  const session = getTruthMeterSession();
  await setTruthMeterReady(name, !session.ready[name]);
}

export function allTruthMeterReady() {
  const session = getTruthMeterSession();
  if (isGameSyncActive()) {
    const remote = truthMeterToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export function simulateTruthMeterReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    setTruthMeterReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export async function markTruthMeterLobbyStarted() {
  const names = getActivePlayerNames();
  const next = {
    ...getTruthMeterSession(),
    lobbyStarted: true,
    authorOrder: shuffleArray(names),
    roundIdx: 0,
    phase: "writing",
    affirmation: null,
    authorEstimate: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
    matchScores: {},
    lastRound: null,
  };
  return launchGameWithSync({
    screen: "truthmeter",
    gameId: "truthmeter",
    mode: "push",
    beforeCommit: async () => {
      if (isGameSyncActive() && isLobbyHost()) {
        const { setLobbyPlaying } = await import("./lobby.js");
        await setLobbyPlaying("truthmeter");
      }
    },
    applyLocal: () => saveStatePatch({ truthMeterGame: next }),
    getRemoteState: () => ({ truthMeter: truthMeterToRemote(next) }),
  });
}

export async function commitTruthMeterPlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "truthmeter",
    stateKey: "truthMeter",
    getSession: getTruthMeterSession,
    saveLocal: (session) => saveStatePatch({ truthMeterGame: session }),
    toRemote: truthMeterToRemote,
    patchOpts,
  });
}

/** MP : envoie uniquement le vote local (évite d'écraser phase reveal de l'hôte). */
export async function commitTruthMeterVote(choice) {
  const localName = getLocalDisplayName();
  const session = getTruthMeterSession();
  if (session.votes?.[localName] != null && Number.isFinite(session.votes[localName])) {
    return session.votes[localName];
  }
  const votes = { ...(session.votes || {}), [localName]: choice };
  saveStatePatch({ truthMeterGame: { ...session, votes } });
  if (!isGameSyncActive()) return choice;
  const uid = userIdForName(localName) || localName;
  await patchGameState({ truthMeter: { votes: { [uid]: choice } } });
  return choice;
}

export function allTruthMeterVotesIn(session = getTruthMeterSession()) {
  const voters = getVoterNames();
  if (!voters.length) return true;
  const votes = normalizePlayerVotesMap(session.votes || {}, voters);
  return voters.every((n) => votes[n] != null && Number.isFinite(votes[n]));
}

export function countTruthMeterVotes(session = getTruthMeterSession()) {
  const voters = getVoterNames();
  return Object.keys(normalizePlayerVotesMap(session.votes || {}, voters)).length;
}

export function getTruthMeterEntryScreen() {
  const session = getTruthMeterSession();
  if (!session.lobbyStarted) return "truthmeter-prep";
  return "truthmeter";
}

/** Votes NPC pour le mode local */
export function simulateTruthMeterVotes(localValue) {
  const author = getCurrentAuthor();
  const result = {};
  const local = getLocalDisplayName();
  getActivePlayerNames().forEach((name) => {
    if (name === author || name === local) return;
    const noise = Math.floor(Math.random() * 41) - 20;
    result[name] = Math.max(0, Math.min(100, localValue + noise));
  });
  if (local !== author) result[local] = localValue;
  return result;
}
