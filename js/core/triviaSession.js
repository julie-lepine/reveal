import {
  TRIVIA_LOBBY_PODIUM_POINTS,
  prepareTriviaDeck,
  TRIVIA_QUESTION_COUNT_PRESETS,
  TRIVIA_RANDOM_THEME_ID,
  TRIVIA_THEMES,
  getTriviaQuestionPool,
  getTriviaThemeLabel,
} from "../../data/trivia.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { addScore, getLocalDisplayName, getState, saveStatePatch, setActiveScoringGame } from "./state.js";
import {
  allMembersReady,
  isGameSyncActive,
  isLobbyHost,
  syncTriviaSession,
  triviaToRemote,
  requireLocalParticipantUid,
  refreshGameSession,
} from "./gameSync.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { normalizeTriviaAnswersMap } from "./sessionMerge.js";
import { playerKeyToDisplayName } from "./gameSync.js";
import { podiumPointsForRank, withCompetitionRanks } from "./competitionRank.js";
import { triviaEveningPoints } from "./triviaScoring.js";
import {
  buildTriviaFinalExplicitPatch,
  buildTriviaNextQuestionExplicitPatch,
  pickTriviaPlayFields,
} from "./triviaPlayPatch.js";
import { createTriviaRunId } from "./triviaRunId.js";
import { scoreTriviaRoundFromAnswers } from "./triviaScoreEngine.js";
import { mapTriviaRevealRpcError, validateTriviaAnswerRequest, validateTriviaRevealRequest } from "./triviaRevealErrors.js";
import {
  evaluateTriviaAnswerRecovery,
  evaluateTriviaRevealRecovery,
  isTriviaRevealBusinessError,
  isTriviaRevealNetworkError,
} from "./triviaRevealRecovery.js";
import { applyRemoteSession } from "./gameSync.js";
import { rpcRevealTriviaRound, rpcSubmitTriviaAnswer } from "./gameSessionRpc.js";

const TRIVIA_ESTIMATE_SEC_PER_QUESTION = 40;

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    selectedThemeId: TRIVIA_RANDOM_THEME_ID,
    questionCount: 5,
    deck: null,
    questionIdx: 0,
    phase: null,
    currentQuestion: null,
    answers: {},
    questionScored: false,
    matchScores: {},
    lastRound: null,
    podiumApplied: false,
    results: null,
    runId: null,
    questionPlayerUids: null,
  };
}

function estimateTriviaDurationLabel(questionCount) {
  const totalSec = questionCount * TRIVIA_ESTIMATE_SEC_PER_QUESTION;
  if (totalSec < 60) return `~${totalSec}s`;
  const minutes = Math.max(1, Math.round(totalSec / 60));
  return `~${minutes} min`;
}

function createTriviaScores(base = {}) {
  const next = { ...base };
  getActivePlayerNames().forEach((name) => {
    if (!Number.isFinite(next[name])) next[name] = 0;
  });
  return next;
}

function buildTriviaQuestionPlayerUids() {
  if (!isGameSyncActive()) return null;
  const uids = getLobbyParticipants()
    .map((p) => p.userId)
    .filter(Boolean)
    .sort();
  return uids.length ? uids : null;
}

function buildQuestionStartPatch(session, questionIdx) {
  const deck = session.deck || [];
  const patch = {
    ...session,
    questionIdx,
    phase: "question",
    currentQuestion: deck[questionIdx] || null,
    answers: {},
    questionScored: false,
    lastRound: null,
    results: null,
  };
  const uids = buildTriviaQuestionPlayerUids();
  if (uids) patch.questionPlayerUids = uids;
  return patch;
}

export function defaultTriviaPrepSession() {
  return defaultSession();
}

export function getTriviaSession() {
  return getState().triviaGame || defaultSession();
}

export function getTriviaThemes() {
  return TRIVIA_THEMES;
}

export function getTriviaQuestionCountPresets() {
  return TRIVIA_QUESTION_COUNT_PRESETS;
}

export function getTriviaThemeId() {
  return getTriviaSession().selectedThemeId || TRIVIA_RANDOM_THEME_ID;
}

export function getTriviaQuestionCount() {
  return getTriviaSession().questionCount ?? 5;
}

export function getTriviaPoolSize(themeId = getTriviaThemeId()) {
  return getTriviaQuestionPool(themeId).length;
}

export function getTriviaPrepSummary() {
  const requested = getTriviaQuestionCount();
  const themeId = getTriviaThemeId();
  const poolSize = getTriviaPoolSize(themeId);
  return {
    themeId,
    themeLabel: getTriviaThemeLabel(themeId),
    poolSize,
    requested,
    durationLabel: estimateTriviaDurationLabel(requested),
    launchable: poolSize >= requested,
    missing: Math.max(0, requested - poolSize),
  };
}

export function validateTriviaLaunchConfig(session = getTriviaSession()) {
  const requested = session.questionCount ?? 5;
  const themeId = session.selectedThemeId || TRIVIA_RANDOM_THEME_ID;
  const poolSize = getTriviaQuestionPool(themeId).length;
  return {
    ok: poolSize >= requested,
    themeId,
    themeLabel: getTriviaThemeLabel(themeId),
    requested,
    poolSize,
    missing: Math.max(0, requested - poolSize),
  };
}

export function isLocalTriviaHost() {
  return isLobbyHost();
}

export async function setTriviaTheme(themeId) {
  const session = getTriviaSession();
  await syncTriviaSession({
    ...session,
    selectedThemeId: themeId,
    deck: null,
  });
}

export async function setTriviaQuestionCount(questionCount) {
  const session = getTriviaSession();
  await syncTriviaSession({
    ...session,
    questionCount,
    deck: null,
  });
}

export async function setTriviaReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getTriviaSession,
    saveLocal: (session) => saveStatePatch({ triviaGame: session }),
    stateKey: "trivia",
    gameId: "trivia",
    screen: "trivia-prep",
  });
}

export async function toggleLocalTriviaReady() {
  const name = getLocalDisplayName();
  const session = getTriviaSession();
  await setTriviaReady(name, !session.ready?.[name]);
}

export function allTriviaReady() {
  const session = getTriviaSession();
  if (isGameSyncActive()) {
    const remote = triviaToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((name) => session.ready?.[name]);
}

export function simulateTriviaReady(onUpdate) {
  const pool = getActivePlayerNames().filter((name) => name !== getLocalDisplayName());
  let idx = 0;
  const timerId = setInterval(() => {
    if (idx >= pool.length) {
      clearInterval(timerId);
      onUpdate?.();
      return;
    }
    void setTriviaReady(pool[idx], true);
    idx += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(timerId);
}

export function buildTriviaDeck(session = getTriviaSession()) {
  const deckResult = prepareTriviaDeck(
    session.selectedThemeId || TRIVIA_RANDOM_THEME_ID,
    session.questionCount ?? 5
  );
  if (!deckResult.ok) return deckResult;
  const next = { ...session, deck: deckResult.deck };
  saveStatePatch({ triviaGame: next });
  return deckResult;
}

export function buildTriviaReplaySession(session = getTriviaSession()) {
  const base = defaultSession();
  return {
    ...base,
    selectedThemeId: session.selectedThemeId || TRIVIA_RANDOM_THEME_ID,
    questionCount: session.questionCount ?? 5,
  };
}

export function createStartedTriviaSession(session = getTriviaSession()) {
  const replaySession = buildTriviaReplaySession(session);
  const deckResult = buildTriviaDeck(replaySession);
  if (!deckResult.ok) return deckResult;
  return {
    ok: true,
    session: buildQuestionStartPatch(
      {
        ...replaySession,
        deck: deckResult.deck,
        lobbyStarted: true,
        matchScores: createTriviaScores(),
        podiumApplied: false,
        runId: createTriviaRunId(),
      },
      0
    ),
  };
}

export async function markTriviaLobbyStarted() {
  const started = createStartedTriviaSession();
  if (!started.ok) return started;
  const next = started.session;

  const result = await launchGameWithSync({
    screen: "trivia",
    gameId: "trivia",
    mode: "push",
    applyLocal: () => saveStatePatch({ triviaGame: next }),
    getRemoteState: () => ({ trivia: triviaToRemote(next) }),
  });
  return { ...result, ok: result.ok !== false, session: next };
}

export async function startTriviaQuestion(questionIdx) {
  const session = getTriviaSession();
  const explicitPatch = buildTriviaNextQuestionExplicitPatch(
    questionIdx,
    buildTriviaQuestionPlayerUids() || []
  );

  if (!isGameSyncActive()) {
    const localNext = buildQuestionStartPatch(session, questionIdx);
    saveStatePatch({ triviaGame: localNext });
    return localNext;
  }

  await commitTriviaPlay(explicitPatch);
  const synced = getTriviaSession();
  const localNext = {
    ...synced,
    currentQuestion: (synced.deck || [])[questionIdx] || null,
    results: null,
  };
  saveStatePatch({ triviaGame: localNext });
  return localNext;
}

export async function commitTriviaPlay(patch, { screen } = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "trivia",
    screen: screen || "trivia",
    stateKey: "trivia",
    getSession: getTriviaSession,
    saveLocal: (session) => saveStatePatch({ triviaGame: session }),
    toRemote: triviaToRemote,
    pickPlayFields: pickTriviaPlayFields,
  });
}

/** BUG-TRIVIA-01B — reveal atomique via RPC (MP uniquement). */
export async function commitTriviaRevealPlay() {
  const session = getTriviaSession();
  if (!isGameSyncActive()) {
    throw new Error("commitTriviaRevealPlay requires MP sync");
  }
  const req = validateTriviaRevealRequest(session);
  if (!req.ok) {
    throw mapTriviaRevealRpcError(new Error(req.code));
  }
  const lobbyId = getState().lobby.id;
  let networkError = null;
  try {
    const row = await rpcRevealTriviaRound({
      lobbyId,
      runId: req.runId,
      questionIdx: req.questionIdx,
    });
    if (row) applyRemoteSession(row);
    return getTriviaSession();
  } catch (err) {
    const mapped = mapTriviaRevealRpcError(err);
    if (isTriviaRevealBusinessError(mapped)) {
      throw mapped;
    }
    if (!isTriviaRevealNetworkError(err) && !isTriviaRevealNetworkError(mapped)) {
      throw mapped;
    }
    networkError = mapped;
  }

  const freshRow = await refreshGameSession();
  if (freshRow) applyRemoteSession(freshRow);
  const recovery = evaluateTriviaRevealRecovery(freshRow?.state?.trivia, {
    runId: req.runId,
    questionIdx: req.questionIdx,
  });
  if (recovery.recovered) {
    return getTriviaSession();
  }
  if (recovery.reason === "stale_run") {
    throw mapTriviaRevealRpcError(new Error("TRIVIA_STALE_RUN"));
  }
  if (recovery.reason === "stale_question") {
    throw mapTriviaRevealRpcError(new Error("TRIVIA_STALE_QUESTION"));
  }
  throw networkError || new Error("Révélation impossible.");
}

export async function commitTriviaFinalPlay() {
  return commitTriviaPlay(buildTriviaFinalExplicitPatch());
}

export {
  buildTriviaNextQuestionExplicitPatch,
  buildTriviaFinalExplicitPatch,
  pickTriviaPlayFields,
};

export async function commitTriviaAnswer(answerIndex) {
  const session = getTriviaSession();
  const localName = getLocalDisplayName();
  if (session.phase !== "question") {
    return session.answers?.[localName] || null;
  }
  if (!Number.isInteger(answerIndex)) {
    throw new Error("Réponse invalide.");
  }
  const prev = session.answers?.[localName];
  if (prev?.answerIndex === answerIndex && !isGameSyncActive()) {
    return prev;
  }

  const answeredAt = Date.now();

  if (!isGameSyncActive()) {
    const nextAnswer = { answerIndex, answeredAt };
    saveStatePatch({
      triviaGame: {
        ...session,
        answers: { ...(session.answers || {}), [localName]: nextAnswer },
      },
    });
    return nextAnswer;
  }

  const req = validateTriviaAnswerRequest(session);
  if (!req.ok) {
    throw mapTriviaRevealRpcError(new Error(req.code));
  }
  const lobbyId = getState().lobby.id;
  const localUid = requireLocalParticipantUid();
  let networkError = null;
  try {
    const row = await rpcSubmitTriviaAnswer({
      lobbyId,
      runId: req.runId,
      questionIdx: req.questionIdx,
      answerIndex,
      answeredAt,
    });
    if (row) applyRemoteSession(row);
    const synced = getTriviaSession();
    return (
      synced.answers?.[localName] ||
      synced.answers?.[localUid] ||
      { answerIndex, answeredAt }
    );
  } catch (err) {
    const mapped = mapTriviaRevealRpcError(err);
    if (isTriviaRevealBusinessError(mapped)) {
      throw mapped;
    }
    if (!isTriviaRevealNetworkError(err) && !isTriviaRevealNetworkError(mapped)) {
      throw mapped;
    }
    networkError = mapped;
  }

  const freshRow = await refreshGameSession();
  if (freshRow) applyRemoteSession(freshRow);
  const recovery = evaluateTriviaAnswerRecovery(freshRow?.state?.trivia, {
    runId: req.runId,
    questionIdx: req.questionIdx,
    answerIndex,
    localUid,
  });
  if (recovery.recovered) {
    const synced = getTriviaSession();
    return (
      synced.answers?.[localName] ||
      synced.answers?.[localUid] ||
      { answerIndex, answeredAt }
    );
  }
  if (recovery.reason === "stale_run") {
    throw mapTriviaRevealRpcError(new Error("TRIVIA_STALE_RUN"));
  }
  if (recovery.reason === "stale_question") {
    throw mapTriviaRevealRpcError(new Error("TRIVIA_STALE_QUESTION"));
  }
  throw new Error("Enregistrement de la réponse impossible.");
}

export function normalizeTriviaAnswers(answers = {}, players = getActivePlayerNames()) {
  return normalizeTriviaAnswersMap(answers, players, (key) => {
    const mapped = playerKeyToDisplayName(key);
    if (mapped) return mapped;
    return players.includes(String(key)) ? String(key) : null;
  });
}

export function countTriviaAnswersIn(answers = getTriviaSession().answers) {
  const normalized = normalizeTriviaAnswers(answers);
  return getActivePlayerNames().filter((name) =>
    Number.isInteger(normalized[name]?.answerIndex)
  ).length;
}

export function getTriviaWaitingPlayers() {
  const answers = normalizeTriviaAnswers(getTriviaSession().answers || {});
  return getActivePlayers().filter((player) => !Number.isInteger(answers[player.name]?.answerIndex));
}

export function allTriviaAnswersIn() {
  const answers = normalizeTriviaAnswers(getTriviaSession().answers || {});
  const names = getActivePlayerNames();
  return (
    names.length > 0 &&
    names.every((name) => Number.isInteger(answers[name]?.answerIndex))
  );
}

export function scoreTriviaRound(session = getTriviaSession()) {
  if (session.questionScored && session.lastRound) {
    return session;
  }
  const question = session.currentQuestion;
  const currentScores = createTriviaScores(session.matchScores || {});
  if (!question) {
    return {
      ...session,
      matchScores: currentScores,
      lastRound: null,
    };
  }

  const normalizedAnswers = normalizeTriviaAnswers(session.answers || {});
  const { matchScores, lastRound } = scoreTriviaRoundFromAnswers({
    correctIndex: question.correct,
    correctAnswer: question.answers?.[question.correct] || "",
    answers: normalizedAnswers,
    matchScores: currentScores,
  });

  return {
    ...session,
    answers: normalizedAnswers,
    questionScored: true,
    matchScores,
    lastRound,
  };
}

export function getTriviaEntryScreen() {
  const session = getTriviaSession();
  return session.lobbyStarted ? "trivia" : "trivia-prep";
}

export function buildTriviaStandings(matchScores = getTriviaSession().matchScores || {}) {
  const scores = createTriviaScores(matchScores);
  return [...getActivePlayers()]
    .map((player) => ({
      ...player,
      score: scores[player.name] || 0,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function getTriviaPodiumAwards(standings = buildTriviaStandings()) {
  return withCompetitionRanks(standings, (p) => p.score).map((player) => ({
    ...player,
    lobbyBonus: podiumPointsForRank(player.rank, TRIVIA_LOBBY_PODIUM_POINTS),
  }));
}

/**
 * Crédite à la soirée le cumul quiz (`matchScores`) + le bonus podium (une fois).
 */
export function applyTriviaLobbyPodium(session = getTriviaSession()) {
  setActiveScoringGame("trivia");
  const standings = getTriviaPodiumAwards(buildTriviaStandings(session.matchScores || {}));
  standings.forEach((player) => {
    const total = triviaEveningPoints(player);
    if (total > 0) addScore(player.name, total);
  });
  return standings;
}

export {
  TRIVIA_QUESTION_COUNT_PRESETS,
  TRIVIA_RANDOM_THEME_ID,
};
