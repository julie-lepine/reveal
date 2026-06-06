import {
  CONSENSUS_MODES,
  CONSENSUS_LOBBY_PODIUM_POINTS,
  CONSENSUS_QUESTION_COUNT_PRESETS,
  CONSENSUS_SYNC_PATCH_TIMEOUT_MS,
  decorateConsensusQuestionForMode,
  getConsensusModeLabel,
  getConsensusQuestionPool,
  prepareConsensusDeck,
} from "../../data/consensus.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { addScore, getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  allMembersReady,
  isGameSyncActive,
  isLobbyHost,
  playerKeyToDisplayName,
  syncConsensusSession,
  consensusToRemote,
  patchGameState,
  userIdForName,
  consensusRevealToRemote,
} from "./gameSync.js";
import { launchGameWithSync, commitHostGamePlay } from "./mpLaunch.js";
import {
  applyConsensusDefaultAnswers as applyConsensusDefaultAnswersCore,
  clampConsensusValue,
  isConsensusAnswerForRound,
  stripStaleConsensusAnswers,
} from "./consensusAnswerUtils.js";

export { clampConsensusValue, isConsensusAnswerForRound } from "./consensusAnswerUtils.js";

/** Estimation prep uniquement (plus de chrono en partie). */
const CONSENSUS_ESTIMATE_SEC_PER_QUESTION = 45;

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    selectedModeId: "standard",
    questionCount: 5,
    deck: null,
    questionIdx: 0,
    phase: null,
    currentQuestion: null,
    answers: {},
    roundScored: false,
    matchScores: {},
    lastRound: null,
    podiumApplied: false,
  };
}

function estimateConsensusDurationLabel(questionCount) {
  const totalSec = questionCount * CONSENSUS_ESTIMATE_SEC_PER_QUESTION;
  if (totalSec < 60) return `~${totalSec}s`;
  const minutes = Math.max(1, Math.round(totalSec / 60));
  return `~${minutes} min`;
}

function createConsensusScores(base = {}) {
  const next = { ...base };
  getActivePlayerNames().forEach((name) => {
    if (!Number.isFinite(next[name])) next[name] = 0;
  });
  return next;
}

function buildQuestionStartPatch(session, questionIdx) {
  const deck = session.deck || [];
  const baseQuestion = deck[questionIdx] || null;
  return {
    ...session,
    questionIdx,
    phase: "question",
    currentQuestion: decorateConsensusQuestionForMode(
      baseQuestion,
      session.selectedModeId || "standard",
      questionIdx
    ),
    answers: {},
    roundScored: false,
    lastRound: null,
  };
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function computeMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeModes(values) {
  if (!values.length) return [];
  const freq = new Map();
  values.forEach((value) => {
    freq.set(value, (freq.get(value) || 0) + 1);
  });
  const maxFreq = Math.max(...freq.values());
  if (maxFreq <= 1) return [];
  return [...freq.entries()]
    .filter(([, count]) => count === maxFreq)
    .map(([value]) => value)
    .sort((a, b) => a - b);
}

function stripAnswersForRound(answers = {}, questionIdx = 0) {
  return stripStaleConsensusAnswers(normalizeConsensusAnswers(answers), questionIdx);
}

export function applyConsensusDefaultAnswers(
  session,
  playerNames = getActivePlayerNames()
) {
  const base = normalizeConsensusSession(session);
  return applyConsensusDefaultAnswersCore(base, playerNames);
}

export function formatConsensusScore(value) {
  const rounded = round1(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function defaultConsensusPrepSession() {
  return defaultSession();
}

function pickLatestConsensusAnswer(localAnswer, remoteAnswer) {
  if (!localAnswer) return remoteAnswer || null;
  if (!remoteAnswer) return localAnswer;
  return (remoteAnswer.timestamp || 0) >= (localAnswer.timestamp || 0)
    ? remoteAnswer
    : localAnswer;
}

function resolveConsensusPlayerName(key) {
  return playerKeyToDisplayName(key) || (getActivePlayerNames().includes(key) ? key : null);
}

function normalizeConsensusAnswers(answers = {}) {
  const out = {};
  Object.entries(answers).forEach(([key, answer]) => {
    const name = resolveConsensusPlayerName(key);
    if (!name || !answer) return;
    out[name] = pickLatestConsensusAnswer(out[name], answer) || answer;
  });
  return out;
}

function normalizeConsensusScores(scores = {}) {
  const out = createConsensusScores();
  Object.entries(scores).forEach(([key, val]) => {
    const name = resolveConsensusPlayerName(key);
    if (!name || typeof val !== "number" || !Number.isFinite(val)) return;
    out[name] = round1(Math.max(out[name] || 0, val));
  });
  return out;
}

function normalizeConsensusLastRound(lastRound) {
  if (!lastRound) return null;
  const mapNames = (list = []) =>
    list
      .map((id) => resolveConsensusPlayerName(id))
      .filter(Boolean);
  const deltas = {};
  Object.entries(lastRound.deltas || {}).forEach(([key, val]) => {
    const name = resolveConsensusPlayerName(key);
    if (!name || typeof val !== "number" || !Number.isFinite(val)) return;
    deltas[name] = round1(Math.max(deltas[name] || 0, val));
  });
  return {
    ...lastRound,
    deltas,
    precisionPlayers: mapNames(lastRound.precisionPlayers),
    closestPlayers: mapNames(lastRound.closestPlayers),
    intuitionPlayers: mapNames(lastRound.intuitionPlayers),
    consensusPlayers: mapNames(lastRound.consensusPlayers),
  };
}

export function normalizeConsensusSession(session) {
  if (!session) return defaultSession();
  const questionIdx = session.questionIdx ?? 0;
  const answers =
    session.phase === "question" ||
    session.phase === "reveal-pending" ||
    session.phase === "reveal"
      ? stripAnswersForRound(session.answers || {}, questionIdx)
      : normalizeConsensusAnswers(session.answers || {});
  return {
    ...session,
    answers,
    matchScores: normalizeConsensusScores(session.matchScores || {}),
    lastRound: normalizeConsensusLastRound(session.lastRound),
  };
}

export function getConsensusSession() {
  const raw = getState().consensusGame || defaultSession();
  return normalizeConsensusSession(raw);
}

export function getConsensusModes() {
  return CONSENSUS_MODES;
}

export function getConsensusModeId() {
  return getConsensusSession().selectedModeId || "standard";
}

export function getConsensusQuestionCount() {
  return getConsensusSession().questionCount ?? 5;
}

export function getConsensusQuestionCountPresets() {
  return CONSENSUS_QUESTION_COUNT_PRESETS;
}

export function getConsensusPoolSize() {
  return getConsensusQuestionPool().length;
}

export function getConsensusPrepSummary() {
  const requested = getConsensusQuestionCount();
  const poolSize = getConsensusPoolSize();
  return {
    modeId: getConsensusModeId(),
    modeLabel: getConsensusModeLabel(getConsensusModeId()),
    poolSize,
    requested,
    durationLabel: estimateConsensusDurationLabel(requested),
    launchable: poolSize >= requested,
    missing: Math.max(0, requested - poolSize),
  };
}

export function validateConsensusLaunchConfig(session = getConsensusSession()) {
  const requested = session.questionCount ?? 5;
  const poolSize = getConsensusQuestionPool().length;
  return {
    ok: poolSize >= requested,
    requested,
    poolSize,
    missing: Math.max(0, requested - poolSize),
  };
}

export function isLocalConsensusHost() {
  const local = getLobbyParticipants().find((player) => player.isLocal);
  return local?.isHost !== false;
}

export async function setConsensusMode(modeId) {
  const session = getConsensusSession();
  await syncConsensusSession({
    ...session,
    selectedModeId: modeId,
    deck: null,
  });
}

export async function setConsensusQuestionCount(questionCount) {
  const session = getConsensusSession();
  await syncConsensusSession({
    ...session,
    questionCount,
    deck: null,
  });
}

export async function setConsensusReady(playerName, ready) {
  const session = getConsensusSession();
  await syncConsensusSession({
    ...session,
    ready: { ...(session.ready || {}), [playerName]: ready },
  });
}

export async function toggleLocalConsensusReady() {
  const name = getLocalDisplayName();
  const session = getConsensusSession();
  await setConsensusReady(name, !session.ready?.[name]);
}

export function allConsensusReady() {
  const session = getConsensusSession();
  if (isGameSyncActive()) {
    const remote = consensusToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((name) => session.ready?.[name]);
}

export function simulateConsensusReady(onUpdate) {
  const pool = getActivePlayerNames().filter((name) => name !== getLocalDisplayName());
  let idx = 0;
  const timerId = setInterval(() => {
    if (idx >= pool.length) {
      clearInterval(timerId);
      onUpdate?.();
      return;
    }
    void setConsensusReady(pool[idx], true);
    idx += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(timerId);
}

export function buildConsensusDeck(session = getConsensusSession()) {
  const deckResult = prepareConsensusDeck(session.questionCount ?? 5);
  if (!deckResult.ok) return deckResult;
  const next = { ...session, deck: deckResult.deck };
  saveStatePatch({ consensusGame: next });
  return deckResult;
}

export function buildConsensusReplaySession(session = getConsensusSession()) {
  const base = defaultSession();
  return {
    ...base,
    selectedModeId: session.selectedModeId || "standard",
    questionCount: session.questionCount ?? 5,
  };
}

export function createStartedConsensusSession(session = getConsensusSession()) {
  const replaySession = buildConsensusReplaySession(session);
  const deckResult = buildConsensusDeck(replaySession);
  if (!deckResult.ok) return deckResult;
  return {
    ok: true,
    session: buildQuestionStartPatch(
      {
        ...replaySession,
        deck: deckResult.deck,
        lobbyStarted: true,
        matchScores: createConsensusScores(),
        podiumApplied: false,
      },
      0
    ),
  };
}

export async function markConsensusLobbyStarted() {
  const started = createStartedConsensusSession();
  if (!started.ok) return started;
  const next = started.session;

  const result = await launchGameWithSync({
    screen: "consensus",
    gameId: "consensus",
    mode: "push",
    applyLocal: () => saveStatePatch({ consensusGame: next }),
    getRemoteState: () => ({ consensus: consensusToRemote(next) }),
  });
  return { ...result, ok: result.ok !== false, session: next };
}

export async function startConsensusQuestion(questionIdx) {
  const next = buildQuestionStartPatch(getConsensusSession(), questionIdx);
  await syncConsensusSession(next);
  return next;
}

export async function commitConsensusPlay(patch, { screen } = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "consensus",
    screen: screen || "consensus",
    stateKey: "consensus",
    getSession: getConsensusSession,
    saveLocal: (session) => saveStatePatch({ consensusGame: session }),
    toRemote: consensusToRemote,
  });
}

const CONSENSUS_MP_PATCH_OPTS = {
  gameId: "consensus",
  screen: "consensus",
  timeoutMs: CONSENSUS_SYNC_PATCH_TIMEOUT_MS,
};

/** MP : patch phase seule (reveal-pending) — évite le blob complet. */
export async function commitConsensusPhase(phase) {
  const session = { ...getConsensusSession(), phase };
  saveStatePatch({ consensusGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ consensus: { phase } }, CONSENSUS_MP_PATCH_OPTS);
  return session;
}

/** MP : patch révélation (scores + réponses imputées, sans deck). */
export async function commitConsensusReveal(scoredSession) {
  const revealSession = { ...scoredSession, phase: "reveal" };
  saveStatePatch({ consensusGame: revealSession });
  if (!isGameSyncActive()) return revealSession;
  await patchGameState(
    { consensus: consensusRevealToRemote(revealSession) },
    CONSENSUS_MP_PATCH_OPTS
  );
  return revealSession;
}

export async function commitConsensusAnswer(value, { submitted = false } = {}) {
  const session = getConsensusSession();
  const localName = getLocalDisplayName();
  const questionIdx = session.questionIdx ?? 0;
  const previous = session.answers?.[localName] || null;
  if (submitted && isConsensusAnswerForRound(previous, questionIdx)) {
    return previous;
  }
  const nextAnswer = {
    value: clampConsensusValue(value),
    timestamp: Date.now(),
    submittedAt: submitted ? Date.now() : previous?.submittedAt || null,
    questionIdx,
    imputed: false,
  };
  const nextAnswers = stripAnswersForRound(session.answers || {}, questionIdx);
  nextAnswers[localName] = nextAnswer;
  saveStatePatch({ consensusGame: { ...session, answers: nextAnswers } });
  if (!isGameSyncActive()) return nextAnswer;
  const uid = userIdForName(localName) || localName;
  await patchGameState({
    consensus: {
      answers: {
        [uid]: {
          value: nextAnswer.value,
          timestamp: nextAnswer.timestamp,
          submittedAt: nextAnswer.submittedAt,
          questionIdx: nextAnswer.questionIdx,
          imputed: nextAnswer.imputed,
        },
      },
    },
  });
  return nextAnswer;
}

export function getConsensusWaitingPlayers() {
  const session = getConsensusSession();
  const questionIdx = session.questionIdx ?? 0;
  return getActivePlayers().filter(
    (player) => !isConsensusAnswerForRound(session.answers?.[player.name], questionIdx)
  );
}

export function allConsensusAnswersIn() {
  const session = getConsensusSession();
  const questionIdx = session.questionIdx ?? 0;
  const names = getActivePlayerNames();
  return (
    names.length > 0 &&
    names.every((name) => isConsensusAnswerForRound(session.answers?.[name], questionIdx))
  );
}

function getExtremesReference(values, target) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return { anchor: 0, anchorLabel: "Extrême", sideThreshold: 0 };
  }
  if (target === "low") {
    const first = sorted[0];
    const second = sorted[1] ?? first;
    return {
      anchor: round1(first === second ? first : (first + second) / 2),
      anchorLabel: "Bord bas",
      sideThreshold: computeMedian(sorted),
    };
  }
  const first = sorted[sorted.length - 1];
  const second = sorted[sorted.length - 2] ?? first;
  return {
    anchor: round1(first === second ? first : (first + second) / 2),
    anchorLabel: "Bord haut",
    sideThreshold: computeMedian(sorted),
  };
}

export function scoreConsensusRound(session = getConsensusSession()) {
  session = applyConsensusDefaultAnswers(normalizeConsensusSession(session));
  if (session.roundScored && session.lastRound) {
    return session;
  }
  const questionIdx = session.questionIdx ?? 0;
  const currentScores = createConsensusScores(session.matchScores || {});
  const entries = Object.entries(session.answers || {})
    .filter(([, answer]) => isConsensusAnswerForRound(answer, questionIdx))
    .map(([name, answer]) => ({
      name,
      value: clampConsensusValue(answer.value),
      timestamp: answer.timestamp || 0,
      submittedAt: answer.submittedAt || null,
    }));

  if (!entries.length) {
    return {
      ...session,
      roundScored: true,
      matchScores: currentScores,
      lastRound: null,
    };
  }

  const values = entries.map((entry) => entry.value);
  const meanExact = values.reduce((sum, value) => sum + value, 0) / values.length;
  const medianExact = computeMedian(values);
  const modes = computeModes(values);
  const modeId = session.currentQuestion?.modeId || session.selectedModeId || "standard";
  const target = session.currentQuestion?.modeTarget || "mean";
  const isExtremes = modeId === "extremes";
  const reference = isExtremes
    ? getExtremesReference(values, target)
    : { anchor: meanExact, anchorLabel: "Moyenne", sideThreshold: medianExact };
  const closestDist = Math.min(
    ...entries.map((entry) => Math.abs(entry.value - reference.anchor))
  );

  const deltas = {};
  const precisionPlayers = [];
  const closestPlayers = [];
  const intuitionPlayers = [];
  const consensusPlayers = [];

  entries.forEach((entry) => {
    const distance = Math.abs(entry.value - reference.anchor);
    let total = Math.max(0, 10 - distance / 10);

    if (distance <= 3) {
      total += 5;
      precisionPlayers.push(entry.name);
    }
    if (Math.abs(distance - closestDist) < 1e-9) {
      total += 10;
      closestPlayers.push(entry.name);
    }

    const intuitionMatch = isExtremes
      ? target === "low"
        ? entry.value <= reference.sideThreshold
        : entry.value >= reference.sideThreshold
      : Math.abs(entry.value - medianExact) <= 5;
    if (intuitionMatch) {
      total += 2;
      intuitionPlayers.push(entry.name);
    }
    if (modes.includes(entry.value)) {
      total += 3;
      consensusPlayers.push(entry.name);
    }

    const roundedScore = round1(total);
    deltas[entry.name] = roundedScore;
    currentScores[entry.name] = round1((currentScores[entry.name] || 0) + roundedScore);
  });

  return {
    ...session,
    roundScored: true,
    matchScores: currentScores,
    lastRound: {
      modeId,
      target,
      mean: round1(meanExact),
      median: round1(medianExact),
      anchor: round1(reference.anchor),
      anchorLabel: reference.anchorLabel,
      modes,
      deltas,
      precisionPlayers,
      closestPlayers,
      intuitionPlayers,
      consensusPlayers,
    },
  };
}

export function getConsensusEntryScreen() {
  const session = getConsensusSession();
  return session.lobbyStarted ? "consensus" : "consensus-prep";
}

export function buildConsensusStandings(matchScores = getConsensusSession().matchScores || {}) {
  const scores = createConsensusScores(matchScores);
  return [...getActivePlayers()]
    .map((player) => ({
      ...player,
      score: round1(scores[player.name] || 0),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function getConsensusPodiumAwards(standings = buildConsensusStandings()) {
  return standings.map((player, index) => ({
    ...player,
    rank: index + 1,
    lobbyBonus: CONSENSUS_LOBBY_PODIUM_POINTS[index] || 0,
  }));
}

export function applyConsensusLobbyPodium(session = getConsensusSession()) {
  const standings = getConsensusPodiumAwards(
    buildConsensusStandings(session.matchScores || {})
  );
  standings.forEach((player) => {
    if (player.lobbyBonus > 0) addScore(player.name, player.lobbyBonus);
  });
  return standings;
}

export {
  CONSENSUS_QUESTION_COUNT_PRESETS,
};
