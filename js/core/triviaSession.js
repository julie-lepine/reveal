import {
  TRIVIA_LOBBY_PODIUM_POINTS,
  TRIVIA_POINTS_CORRECT,
  TRIVIA_POINTS_FASTEST,
  prepareTriviaDeck,
  TRIVIA_QUESTION_COUNT_PRESETS,
  TRIVIA_RANDOM_THEME_ID,
  TRIVIA_THEMES,
  getTriviaQuestionPool,
  getTriviaThemeLabel,
} from "../../data/trivia.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { addScore, getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  allMembersReady,
  isGameSyncActive,
  isLobbyHost,
  syncTriviaSession,
  triviaToRemote,
  userIdForName,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";

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

function buildQuestionStartPatch(session, questionIdx) {
  const deck = session.deck || [];
  return {
    ...session,
    questionIdx,
    phase: "question",
    currentQuestion: deck[questionIdx] || null,
    answers: {},
    questionScored: false,
    lastRound: null,
    results: null,
  };
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
  const next = buildQuestionStartPatch(getTriviaSession(), questionIdx);
  await syncTriviaSession(next);
  return next;
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
  });
}

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
  if (prev?.answerIndex === answerIndex) {
    return prev;
  }
  const nextAnswer = {
    answerIndex,
    answeredAt: Date.now(),
  };
  const nextAnswers = {
    ...(session.answers || {}),
    [localName]: nextAnswer,
  };
  saveStatePatch({ triviaGame: { ...session, answers: nextAnswers } });
  if (!isGameSyncActive()) return nextAnswer;
  const uid = userIdForName(localName) || localName;
  await patchGameStateWithFeedback({
    trivia: {
      answers: {
        [uid]: {
          answerIndex: nextAnswer.answerIndex,
          answeredAt: nextAnswer.answeredAt,
        },
      },
    },
  });
  return nextAnswer;
}

export function getTriviaWaitingPlayers() {
  const answers = getTriviaSession().answers || {};
  return getActivePlayers().filter((player) => !answers[player.name]);
}

export function allTriviaAnswersIn() {
  const answers = getTriviaSession().answers || {};
  const names = getActivePlayerNames();
  return names.length > 0 && names.every((name) => answers[name] && Number.isInteger(answers[name].answerIndex));
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

  const answerEntries = Object.entries(session.answers || {}).filter(([, answer]) =>
    Number.isInteger(answer?.answerIndex)
  );
  const correctEntries = answerEntries.filter(([, answer]) => answer.answerIndex === question.correct);
  correctEntries.sort(
    ([nameA, answerA], [nameB, answerB]) =>
      (answerA?.answeredAt || Number.MAX_SAFE_INTEGER) -
        (answerB?.answeredAt || Number.MAX_SAFE_INTEGER) || nameA.localeCompare(nameB)
  );

  const fastestPlayer = correctEntries[0]?.[0] || null;
  const deltas = {};

  correctEntries.forEach(([name]) => {
    currentScores[name] = (currentScores[name] || 0) + TRIVIA_POINTS_CORRECT;
    deltas[name] = (deltas[name] || 0) + TRIVIA_POINTS_CORRECT;
  });

  if (fastestPlayer) {
    currentScores[fastestPlayer] = (currentScores[fastestPlayer] || 0) + TRIVIA_POINTS_FASTEST;
    deltas[fastestPlayer] = (deltas[fastestPlayer] || 0) + TRIVIA_POINTS_FASTEST;
  }

  return {
    ...session,
    questionScored: true,
    matchScores: currentScores,
    lastRound: {
      correctIndex: question.correct,
      correctAnswer: question.answers?.[question.correct] || "",
      correctPlayers: correctEntries.map(([name]) => name),
      fastestPlayer,
      deltas,
    },
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
  return standings.map((player, index) => ({
    ...player,
    rank: index + 1,
    lobbyBonus: TRIVIA_LOBBY_PODIUM_POINTS[index] || 0,
  }));
}

export function applyTriviaLobbyPodium(session = getTriviaSession()) {
  const standings = getTriviaPodiumAwards(buildTriviaStandings(session.matchScores || {}));
  standings.forEach((player) => {
    if (player.lobbyBonus > 0) addScore(player.name, player.lobbyBonus);
  });
  return standings;
}

export {
  TRIVIA_QUESTION_COUNT_PRESETS,
  TRIVIA_RANDOM_THEME_ID,
};
