import {
  CONSENSUS_MODES,
  CONSENSUS_QUESTION_COUNT_PRESETS,
  CONSENSUS_SYNC_PATCH_TIMEOUT_MS,
  decorateConsensusQuestionForMode,
  getConsensusModeLabel,
  getConsensusQuestionPool,
  prepareConsensusDeck,
} from "../../data/consensus.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { addScore, getLocalDisplayName, getState, saveStatePatch, setActiveScoringGame } from "./state.js";
import { withCompetitionRanks } from "./competitionRank.js";
import {
  allMembersReady,
  isGameSyncActive,
  isLobbyHost,
  canActAsHost,
  playerKeyToDisplayName,
  syncConsensusSession,
  consensusToRemote,
  patchGameState,
  requireLocalParticipantUid,
  consensusRevealToRemote,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import {
  canRollbackOptimisticSubmission,
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
} from "./optimisticMapEntry.js";
import {
  applyConsensusDefaultAnswers as applyConsensusDefaultAnswersCore,
  pickLatestConsensusAnswer,
  clampConsensusValue,
  isConsensusAnswerForRound,
  isScorableConsensusAnswer,
  stripStaleConsensusAnswers,
} from "./consensusAnswerUtils.js";

export { clampConsensusValue, isConsensusAnswerForRound } from "./consensusAnswerUtils.js";

/** Estimation prep uniquement (plus de chrono en partie). */
const CONSENSUS_ESTIMATE_SEC_PER_QUESTION = 45;

/**
 * Marqueur d'une écriture Consensus peut-être encore en vol.
 * Clé distincte du compteur : le compteur survit au retrait du marqueur.
 * Hors du blob `consensusGame` : jamais envoyé au serveur.
 */
const CONSENSUS_WRITE_MARKER_KEY = "reveal.consensus.writeMarker";
const CONSENSUS_WRITE_ATTEMPT_KEY = "reveal.consensus.writeAttemptHighWater";
const memoryWriteStore = new Map();

function consensusWriteStore() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch {
    /* mode privé */
  }
  return {
    getItem: (key) => (memoryWriteStore.has(key) ? memoryWriteStore.get(key) : null),
    setItem: (key, value) => {
      memoryWriteStore.set(key, String(value));
    },
    removeItem: (key) => {
      memoryWriteStore.delete(key);
    },
  };
}

function readConsensusWriteMarker() {
  try {
    const raw = consensusWriteStore().getItem(CONSENSUS_WRITE_MARKER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.lobbyId || parsed.attemptId == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeConsensusWriteMarker(marker) {
  consensusWriteStore().setItem(CONSENSUS_WRITE_MARKER_KEY, JSON.stringify(marker));
}

function clearConsensusWriteMarker() {
  consensusWriteStore().removeItem(CONSENSUS_WRITE_MARKER_KEY);
}

function currentConsensusLobbyId() {
  return getState().lobby?.id || null;
}

/** Vrai tant qu'une écriture Consensus de ce lobby n'a pas été confirmée par sa promesse. */
export function consensusLobbyWriteBlocked() {
  if (!isGameSyncActive()) return false;
  const marker = readConsensusWriteMarker();
  const lobbyId = currentConsensusLobbyId();
  if (!marker || !lobbyId) return false;
  return marker.lobbyId === lobbyId;
}

function allocateConsensusAttemptId() {
  const store = consensusWriteStore();
  const current = Number(store.getItem(CONSENSUS_WRITE_ATTEMPT_KEY));
  const next = Number.isFinite(current) && current >= 0 ? Math.floor(current) + 1 : 1;
  store.setItem(CONSENSUS_WRITE_ATTEMPT_KEY, String(next));
  return next;
}

/**
 * Pose le marqueur avant toute requête. Refus si un doute existe déjà pour ce lobby.
 * Le compteur est incrémenté dans sa propre clé, même si le marqueur est ensuite retiré.
 */
function reserveConsensusServerWrite(step) {
  if (consensusLobbyWriteBlocked()) return { ok: false, blocked: true };
  const lobbyId = currentConsensusLobbyId();
  const attemptId = allocateConsensusAttemptId();
  writeConsensusWriteMarker({
    lobbyId,
    questionIdx: getConsensusSession().questionIdx ?? 0,
    step,
    attemptId,
  });
  return { ok: true, attemptId };
}

/** Retire le marqueur seulement si c'est encore celui de cette tentative. */
function settleConsensusServerWrite(attemptId) {
  const marker = readConsensusWriteMarker();
  if (!marker) return false;
  if (marker.attemptId !== attemptId) return false;
  if (marker.lobbyId !== currentConsensusLobbyId()) return false;
  clearConsensusWriteMarker();
  return true;
}

export class ConsensusWriteBlockedError extends Error {
  constructor() {
    super("Écriture Consensus en attente de confirmation.");
    this.name = "ConsensusWriteBlockedError";
    this.code = "CONSENSUS_WRITE_BLOCKED";
  }
}

let consensusAnswerAttemptId = 0;

/** Écrans Consensus montés pendant le lancement. Pas un bus global. */
const consensusLaunchEndedListeners = new Set();

export function subscribeConsensusLaunchEnded(listener) {
  consensusLaunchEndedListeners.add(listener);
  return () => {
    consensusLaunchEndedListeners.delete(listener);
  };
}

function notifyConsensusLaunchEnded() {
  [...consensusLaunchEndedListeners].forEach((listener) => {
    try {
      listener();
    } catch (err) {
      console.warn("Consensus launch ended:", err);
    }
  });
}

export function __resetConsensusWriteGuardForTests() {
  const store = consensusWriteStore();
  store.removeItem(CONSENSUS_WRITE_MARKER_KEY);
  store.removeItem(CONSENSUS_WRITE_ATTEMPT_KEY);
  consensusAnswerAttemptId = 0;
  consensusLaunchEndedListeners.clear();
}

export function __getConsensusWriteMarkerForTests() {
  return readConsensusWriteMarker();
}

export function __getConsensusAttemptHighWaterForTests() {
  return Number(consensusWriteStore().getItem(CONSENSUS_WRITE_ATTEMPT_KEY)) || 0;
}

export function __setConsensusWriteMarkerForTests(marker) {
  writeConsensusWriteMarker(marker);
}

export function __settleConsensusServerWriteForTests(attemptId) {
  return settleConsensusServerWrite(attemptId);
}

export function __setConsensusAnswerAttemptForTests(attemptId) {
  consensusAnswerAttemptId = attemptId;
}

/**
 * Pose le marqueur puis n'appelle settle que si la promesse aboutit avec un résultat.
 * Un rejet, avec ou sans `code`, conserve le marqueur.
 */
export async function guardConsensusServerWrite(step, run) {
  if (!isGameSyncActive()) return run();
  const reserved = reserveConsensusServerWrite(step);
  if (!reserved.ok) throw new ConsensusWriteBlockedError();
  const result = await run();
  if (result != null) settleConsensusServerWrite(reserved.attemptId);
  return result;
}

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
  return isLobbyHost();
}

export async function setConsensusMode(modeId) {
  const session = getConsensusSession();
  const next = { ...session, selectedModeId: modeId, deck: null };
  if (!isGameSyncActive()) {
    saveStatePatch({ consensusGame: next });
    return;
  }
  const reserved = reserveConsensusServerWrite("prep-mode");
  if (!reserved.ok) return;
  try {
    await syncConsensusSession(next);
    settleConsensusServerWrite(reserved.attemptId);
  } catch (err) {
    throw err;
  }
}

export async function setConsensusQuestionCount(questionCount) {
  const session = getConsensusSession();
  const next = { ...session, questionCount, deck: null };
  if (!isGameSyncActive()) {
    saveStatePatch({ consensusGame: next });
    return;
  }
  const reserved = reserveConsensusServerWrite("prep-count");
  if (!reserved.ok) return;
  try {
    await syncConsensusSession(next);
    settleConsensusServerWrite(reserved.attemptId);
  } catch (err) {
    throw err;
  }
}

export async function setConsensusReady(playerName, ready) {
  const run = () =>
    commitPrepReadyToggle({
      readyKey: playerName,
      ready,
      getSession: getConsensusSession,
      saveLocal: (session) => saveStatePatch({ consensusGame: session }),
      stateKey: "consensus",
      gameId: "consensus",
      screen: "consensus-prep",
    });
  if (!isGameSyncActive()) {
    await run();
    return;
  }
  const reserved = reserveConsensusServerWrite("prep-ready");
  if (!reserved.ok) return;
  try {
    const result = await run();
    if (result && result[playerName] === ready) {
      settleConsensusServerWrite(reserved.attemptId);
    }
  } catch (err) {
    throw err;
  }
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
  if (isGameSyncActive() && consensusLobbyWriteBlocked()) {
    return { ok: false, blocked: true };
  }
  const started = createStartedConsensusSession();
  if (!started.ok) return started;
  const next = started.session;

  // Risque résiduel, hors de ce marqueur : si ce lancement expire, launchGameWithSync
  // appelle retryLaunchCommitInBackground (mpLaunch.js) pendant que le premier upsert
  // peut encore aboutir. Les deux portent l'instantané de départ et peuvent écraser
  // une transition plus récente. Ce ticket ne modifie pas ce retry.
  let reserved = null;
  try {
    if (isGameSyncActive()) {
      reserved = reserveConsensusServerWrite("lobby-start");
      if (!reserved.ok) return { ok: false, blocked: true };
    }

    const result = await launchGameWithSync({
      screen: "consensus",
      gameId: "consensus",
      mode: "push",
      applyLocal: () => saveStatePatch({ consensusGame: next }),
      getRemoteState: () => ({ consensus: consensusToRemote(next) }),
    });
    const confirmed = result?.ok === true && !result?.usedFallback;
    if (reserved && confirmed) settleConsensusServerWrite(reserved.attemptId);
    return { ...result, ok: result.ok !== false, session: next };
  } catch (err) {
    throw err;
  } finally {
    if (reserved?.ok) notifyConsensusLaunchEnded();
  }
}

function confirmedConsensusQuestion(prepared, live) {
  if (!live || !prepared) return false;
  if ((live.questionIdx ?? 0) !== (prepared.questionIdx ?? 0)) return false;
  return live.phase === "question";
}

export async function startConsensusQuestion(questionIdx) {
  const confirmed = getConsensusSession();
  const next = buildQuestionStartPatch(confirmed, questionIdx);
  if (!isGameSyncActive()) {
    await syncConsensusSession(next);
    return next;
  }
  const baselineIdx = confirmed.questionIdx ?? 0;
  const baselinePhase = confirmed.phase;
  const reserved = reserveConsensusServerWrite("next-question");
  if (!reserved.ok) throw new ConsensusWriteBlockedError();
  const beforeSend = getConsensusSession();
  if ((beforeSend.questionIdx ?? 0) !== baselineIdx || beforeSend.phase !== baselinePhase) {
    return beforeSend;
  }
  try {
    await patchGameState({ consensus: consensusToRemote(next) }, CONSENSUS_MP_PATCH_OPTS);
    const live = getConsensusSession();
    if (!confirmedConsensusQuestion(next, live)) return live;
    settleConsensusServerWrite(reserved.attemptId);
    return live;
  } catch (err) {
    throw err;
  }
}

export async function commitConsensusPlay(patch, { screen } = {}) {
  const run = () =>
    commitHostGamePlay({
      patch,
      gameId: "consensus",
      screen: screen || "consensus",
      stateKey: "consensus",
      getSession: getConsensusSession,
      saveLocal: (session) => saveStatePatch({ consensusGame: session }),
      toRemote: consensusToRemote,
    });
  if (!isGameSyncActive() || !canActAsHost()) return run();
  const reserved = reserveConsensusServerWrite("play");
  if (!reserved.ok) throw new ConsensusWriteBlockedError();
  try {
    const result = await run();
    settleConsensusServerWrite(reserved.attemptId);
    return result;
  } catch (err) {
    throw err;
  }
}

const CONSENSUS_MP_PATCH_OPTS = {
  gameId: "consensus",
  screen: "consensus",
  timeoutMs: CONSENSUS_SYNC_PATCH_TIMEOUT_MS,
};

/** MP : patch phase seule (reveal-pending) - évite le blob complet. */
export async function commitConsensusPhase(phase) {
  const session = { ...getConsensusSession(), phase };
  if (!isGameSyncActive()) {
    saveStatePatch({ consensusGame: session });
    return session;
  }
  if (!canActAsHost()) return getConsensusSession();
  const reserved = reserveConsensusServerWrite(
    phase === "reveal-pending" ? "reveal-pending" : `phase:${phase}`
  );
  if (!reserved.ok) throw new ConsensusWriteBlockedError();
  try {
    await patchGameState({ consensus: { phase } }, CONSENSUS_MP_PATCH_OPTS);
    settleConsensusServerWrite(reserved.attemptId);
    return getConsensusSession();
  } catch (err) {
    throw err;
  }
}

/** MP : patch révélation (scores + réponses imputées, sans deck ni currentQuestion). */
export async function commitConsensusReveal(scoredSession) {
  const revealSession = { ...scoredSession, phase: "reveal" };
  if (!isGameSyncActive()) {
    saveStatePatch({ consensusGame: revealSession });
    return revealSession;
  }
  if (!canActAsHost()) return getConsensusSession();
  const reserved = reserveConsensusServerWrite("reveal");
  if (!reserved.ok) throw new ConsensusWriteBlockedError();
  const remote = consensusRevealToRemote(revealSession);
  delete remote.currentQuestion;
  try {
    await patchGameState({ consensus: remote }, CONSENSUS_MP_PATCH_OPTS);
    settleConsensusServerWrite(reserved.attemptId);
    return getConsensusSession();
  } catch (err) {
    throw err;
  }
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
  const baseAnswers = stripAnswersForRound(session.answers || {}, questionIdx);
  const apply = computeOptimisticMapEntryApply({
    map: baseAnswers,
    key: localName,
    value: nextAnswer,
  });
  if (!isGameSyncActive()) {
    saveStatePatch({ consensusGame: { ...session, answers: apply.nextMap } });
    return nextAnswer;
  }
  if (consensusLobbyWriteBlocked()) throw new ConsensusWriteBlockedError();
  const reserved = reserveConsensusServerWrite("answer");
  if (!reserved.ok) throw new ConsensusWriteBlockedError();
  const answerAttemptId = ++consensusAnswerAttemptId;
  const captured = { phase: session.phase, questionIdx };
  saveStatePatch({ consensusGame: { ...session, answers: apply.nextMap } });
  try {
    const uid = requireLocalParticipantUid();
    await patchGameStateWithFeedback({
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
    settleConsensusServerWrite(reserved.attemptId);
    return nextAnswer;
  } catch (err) {
    const live = getConsensusSession();
    if (
      canRollbackOptimisticSubmission(
        { phase: captured.phase, roundIdx: captured.questionIdx },
        { phase: live.phase, roundIdx: live.questionIdx ?? 0 }
      )
    ) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: live.answers,
        key: localName,
        hadPreviousValue: apply.hadPreviousValue,
        previousValue: apply.previousValue,
        optimisticValue: apply.optimisticValue,
        attemptId: answerAttemptId,
        currentAttemptId: consensusAnswerAttemptId,
      });
      if (rolled.applied) {
        saveStatePatch({ consensusGame: { ...live, answers: rolled.map } });
      }
    }
    throw err;
  }
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
  // Seules les vraies réponses comptent : un joueur absent (réponse imputée à 50 %)
  // ne doit ni fausser la moyenne / médiane / ancre, ni recevoir de points.
  const entries = Object.entries(session.answers || {})
    .filter(([, answer]) => isScorableConsensusAnswer(answer, questionIdx))
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
      total += 15;
      closestPlayers.push(entry.name);
    }

    const intuitionMatch = isExtremes
      ? target === "low"
        ? entry.value <= reference.sideThreshold
        : entry.value >= reference.sideThreshold
      : Math.abs(entry.value - medianExact) <= 5;
    if (intuitionMatch) {
      total += 5;
      intuitionPlayers.push(entry.name);
    }
    if (modes.includes(entry.value)) {
      total += 5;
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
  return withCompetitionRanks(standings, (p) => p.score).map((player) => ({
    ...player,
    lobbyBonus: 0,
  }));
}

/**
 * Crédite le cumul `matchScores` à la soirée (une fois).
 * Pas de bonus podium supplémentaire - les points de manches sont la seule source.
 */
export function applyConsensusLobbyPodium(session = getConsensusSession()) {
  setActiveScoringGame("consensus");
  const standings = getConsensusPodiumAwards(
    buildConsensusStandings(session.matchScores || {})
  );
  standings.forEach((player) => {
    const pts = player.score;
    if (typeof pts === "number" && Number.isFinite(pts) && pts > 0) {
      addScore(player.name, pts);
    }
  });
  return standings;
}

export {
  CONSENSUS_QUESTION_COUNT_PRESETS,
};
