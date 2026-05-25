import {
  CONSENSUS_MODES,
  CONSENSUS_LOBBY_PODIUM_POINTS,
  CONSENSUS_QUESTION_COUNT_PRESETS,
  CONSENSUS_TIMER_SEC,
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
  pushGameSession,
  syncConsensusSession,
  consensusToRemote,
} from "./gameSync.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    selectedModeId: "standard",
    questionCount: 5,
    questionTimeSec: CONSENSUS_TIMER_SEC,
    deck: null,
    questionIdx: 0,
    phase: null,
    currentQuestion: null,
    answers: {},
    questionEndsAt: null,
    roundScored: false,
    matchScores: {},
    lastRound: null,
    podiumApplied: false,
  };
}

function estimateConsensusDurationLabel(questionCount, questionTimeSec = CONSENSUS_TIMER_SEC) {
  const totalSec = questionCount * (questionTimeSec + 7);
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
    questionEndsAt: new Date(Date.now() + CONSENSUS_TIMER_SEC * 1000).toISOString(),
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

export function clampConsensusValue(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

export function formatConsensusScore(value) {
  const rounded = round1(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function defaultConsensusPrepSession() {
  return defaultSession();
}

export function getConsensusSession() {
  return getState().consensusGame || defaultSession();
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
    questionTimeSec: CONSENSUS_TIMER_SEC,
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
    questionTimeSec: session.questionTimeSec ?? CONSENSUS_TIMER_SEC,
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
  saveStatePatch({ consensusGame: next });
  if (isGameSyncActive() && isLobbyHost()) {
    await pushGameSession({
      screen: "consensus",
      gameId: "consensus",
      state: { consensus: consensusToRemote(next) },
    });
  }
  return { ok: true, session: next };
}

export async function startConsensusQuestion(questionIdx) {
  const next = buildQuestionStartPatch(getConsensusSession(), questionIdx);
  await syncConsensusSession(next);
  return next;
}

export async function commitConsensusPlay(patch, { screen } = {}) {
  const session = { ...getConsensusSession(), ...patch };
  const next = await syncConsensusSession(session);
  if (screen && isGameSyncActive()) {
    await pushGameSession({
      screen,
      gameId: "consensus",
      state: { consensus: consensusToRemote(next) },
    });
  }
  return next;
}

export async function commitConsensusAnswer(value, { submitted = false } = {}) {
  const session = getConsensusSession();
  const localName = getLocalDisplayName();
  const previous = session.answers?.[localName] || null;
  const nextAnswer = {
    value: clampConsensusValue(value),
    timestamp: Date.now(),
    submittedAt: submitted ? Date.now() : previous?.submittedAt || null,
  };
  const nextAnswers = {
    ...(session.answers || {}),
    [localName]: nextAnswer,
  };
  await syncConsensusSession({
    ...session,
    answers: nextAnswers,
  });
  return nextAnswer;
}

export function getConsensusWaitingPlayers() {
  const answers = getConsensusSession().answers || {};
  return getActivePlayers().filter((player) => !answers[player.name]?.submittedAt);
}

export function allConsensusAnswersIn() {
  const answers = getConsensusSession().answers || {};
  const names = getActivePlayerNames();
  return names.length > 0 && names.every((name) => Boolean(answers[name]?.submittedAt));
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
  const currentScores = createConsensusScores(session.matchScores || {});
  const entries = Object.entries(session.answers || {})
    .filter(([, answer]) => Number.isFinite(answer?.value))
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
  CONSENSUS_TIMER_SEC,
};
