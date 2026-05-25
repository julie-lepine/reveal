import {
  TRIVIA_LOBBY_PODIUM_POINTS,
  TRIVIA_POINTS_CORRECT,
  TRIVIA_POINTS_FASTEST,
  prepareTriviaDeck,
  TRIVIA_QUESTION_COUNT_PRESETS,
  TRIVIA_RANDOM_THEME_ID,
  TRIVIA_THEMES,
  TRIVIA_TIMER_SEC,
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
  pushGameSession,
  syncTriviaSession,
  triviaToRemote,
} from "./gameSync.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    selectedThemeId: TRIVIA_RANDOM_THEME_ID,
    questionCount: 5,
    questionTimeSec: TRIVIA_TIMER_SEC,
    deck: null,
    questionIdx: 0,
    phase: null,
    currentQuestion: null,
    answers: {},
    questionEndsAt: null,
    questionScored: false,
    matchScores: {},
    lastRound: null,
    podiumApplied: false,
    results: null,
  };
}

function estimateTriviaDurationLabel(questionCount, questionTimeSec = TRIVIA_TIMER_SEC) {
  const totalSec = questionCount * (questionTimeSec + 5);
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
    questionEndsAt: new Date(Date.now() + TRIVIA_TIMER_SEC * 1000).toISOString(),
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
    questionTimeSec: TRIVIA_TIMER_SEC,
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
  const local = getLobbyParticipants().find((player) => player.isLocal);
  return local?.isHost !== false;
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
  const session = getTriviaSession();
  await syncTriviaSession({
    ...session,
    ready: { ...(session.ready || {}), [playerName]: ready },
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
    questionTimeSec: session.questionTimeSec ?? TRIVIA_TIMER_SEC,
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

  saveStatePatch({ triviaGame: next });
  if (isGameSyncActive() && isLobbyHost()) {
    await pushGameSession({
      screen: "trivia",
      gameId: "trivia",
      state: { trivia: triviaToRemote(next) },
    });
  }
  return { ok: true, session: next };
}

export async function startTriviaQuestion(questionIdx) {
  const next = buildQuestionStartPatch(getTriviaSession(), questionIdx);
  await syncTriviaSession(next);
  return next;
}

export async function commitTriviaPlay(patch, { screen } = {}) {
  const session = { ...getTriviaSession(), ...patch };
  const next = await syncTriviaSession(session);
  if (screen && isGameSyncActive()) {
    await pushGameSession({
      screen,
      gameId: "trivia",
      state: { trivia: triviaToRemote(next) },
    });
  }
  return next;
}

export async function commitTriviaAnswer(answerIndex) {
  const session = getTriviaSession();
  const localName = getLocalDisplayName();
  const nextAnswers = {
    ...(session.answers || {}),
    [localName]: {
      answerIndex,
      answeredAt: Date.now(),
    },
  };
  await syncTriviaSession({
    ...session,
    answers: nextAnswers,
  });
  return nextAnswers[localName];
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
  TRIVIA_TIMER_SEC,
};
