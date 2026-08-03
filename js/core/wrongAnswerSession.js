import {
  WRONG_ANSWER_MAX_LEN,
  prepareWrongAnswerDeck,
} from "../../data/wrongAnswer.js";
import { getActivePlayerNames } from "./players.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  syncWrongAnswerSession,
  allMembersReady,
  wrongAnswerToRemote,
  requireLocalParticipantUid,
  requirePlayerUid,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { checkHotTakeModeration } from "./hotTakeSession.js";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "./optimisticMapEntry.js";

let wrongAnswerVoteAttemptId = 0;
let wrongAnswerAnswerAttemptId = 0;

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    roundCount: 5,
    deck: null,
    roundIdx: 0,
    phase: null,
    currentPrompt: null,
    roundStartAt: null,
    answers: {},
    votes: {},
    roundScored: false,
    matchScores: {},
    lastRound: null,
  };
}

export function getWrongAnswerSession() {
  return getState().wrongAnswerGame || defaultSession();
}

export function defaultWrongAnswerPrepSession() {
  return defaultSession();
}

export function getWrongAnswerRoundCount() {
  return getWrongAnswerSession().roundCount ?? 5;
}

export async function setWrongAnswerRoundCount(count) {
  const session = getWrongAnswerSession();
  await syncWrongAnswerSession({ ...session, roundCount: count });
}

export function getWrongAnswerPrepSummary() {
  const requested = getWrongAnswerRoundCount();
  return {
    requested,
    effective: requested,
    durationLabel: `${requested} manche${requested > 1 ? "s" : ""}`,
  };
}

/** Tronque + nettoie une réponse saisie. */
export function sanitizeWrongAnswer(text) {
  return String(text ?? "").trim().slice(0, WRONG_ANSWER_MAX_LEN);
}

/** Charge utile d'une nouvelle manche : prompt courant + phase de saisie. */
function roundPayload(deck, roundIdx) {
  return {
    roundIdx,
    phase: "answer",
    currentPrompt: deck?.[roundIdx] || null,
    roundStartAt: new Date().toISOString(),
    answers: {},
    votes: {},
    roundScored: false,
    lastRound: null,
  };
}

export async function markWrongAnswerLobbyStarted() {
  const session = getWrongAnswerSession();
  const built = prepareWrongAnswerDeck(session.roundCount ?? 5);
  const deck = built.ok ? built.deck : [];
  const next = {
    ...session,
    lobbyStarted: true,
    deck,
    matchScores: {},
    ...roundPayload(deck, 0),
  };
  return launchGameWithSync({
    screen: "wronganswer",
    gameId: "wronganswer",
    mode: "push",
    applyLocal: () => saveStatePatch({ wrongAnswerGame: next }),
    getRemoteState: () => ({ wrongAnswer: wrongAnswerToRemote(next) }),
  });
}

export async function startWrongAnswerRound(roundIdx) {
  const session = getWrongAnswerSession();
  const next = {
    ...session,
    ...roundPayload(session.deck, roundIdx),
  };
  await syncWrongAnswerSession(next);
  return next;
}

export async function commitWrongAnswerPlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "wronganswer",
    stateKey: "wrongAnswer",
    getSession: getWrongAnswerSession,
    saveLocal: (session) => saveStatePatch({ wrongAnswerGame: session }),
    toRemote: wrongAnswerToRemote,
    patchOpts,
  });
}

export async function setWrongAnswerReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getWrongAnswerSession,
    saveLocal: (session) => saveStatePatch({ wrongAnswerGame: session }),
    stateKey: "wrongAnswer",
    gameId: "wronganswer",
    screen: "wronganswer-prep",
  });
}

export function allWrongAnswerReady() {
  const session = getWrongAnswerSession();
  if (isGameSyncActive()) {
    const remote = wrongAnswerToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

/** MP : envoie uniquement la réponse locale ({ text, at }). Première réponse conservée.
 * Rollback conditionnel si sync échoue (01F). */
export async function commitWrongAnswerAnswer(text) {
  const localName = getLocalDisplayName();
  const session = getWrongAnswerSession();
  if (session.answers?.[localName]?.text) {
    return session.answers[localName];
  }
  const cleanText = sanitizeWrongAnswer(text);
  if (!cleanText || checkHotTakeModeration(cleanText).blocked) return null;
  const answer = { text: cleanText, at: Date.now() };
  const attemptId = ++wrongAnswerAnswerAttemptId;
  const captured = { phase: session.phase, roundIdx: session.roundIdx };
  const apply = computeOptimisticMapEntryApply({
    map: session.answers,
    key: localName,
    value: answer,
  });
  saveStatePatch({ wrongAnswerGame: { ...session, answers: apply.nextMap } });
  if (!isGameSyncActive()) return answer;

  try {
    const uid = requireLocalParticipantUid();
    await patchGameStateWithFeedback(
      { wrongAnswer: { answers: { [uid]: answer } } },
      { gameId: "wronganswer", screen: "wronganswer" }
    );
    return answer;
  } catch (err) {
    const live = getWrongAnswerSession();
    if (
      attemptId === wrongAnswerAnswerAttemptId &&
      canRollbackOptimisticSubmission(captured, live)
    ) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: live.answers,
        key: localName,
        hadPreviousValue: apply.hadPreviousValue,
        previousValue: apply.previousValue,
        optimisticValue: apply.optimisticValue,
        attemptId,
        currentAttemptId: wrongAnswerAnswerAttemptId,
      });
      if (rolled.applied) {
        saveStatePatch({ wrongAnswerGame: { ...live, answers: rolled.map } });
      }
    }
    throw err;
  }
}

/** MP : envoie uniquement le vote local. Rollback conditionnel si sync échoue. */
export async function commitWrongAnswerVote(targetName) {
  const localName = getLocalDisplayName();
  const session = getWrongAnswerSession();
  const attemptId = ++wrongAnswerVoteAttemptId;
  const captured = { phase: session.phase, roundIdx: session.roundIdx };
  const apply = computeOptimisticMapEntryApply({
    map: session.votes,
    key: localName,
    value: targetName,
  });
  saveStatePatch({ wrongAnswerGame: { ...session, votes: apply.nextMap } });
  if (!isGameSyncActive()) return apply.nextMap;

  try {
    const uid = requireLocalParticipantUid();
    const targetUid = requirePlayerUid(targetName);
    await patchGameStateWithFeedback(
      { wrongAnswer: { votes: { [uid]: targetUid } } },
      { gameId: "wronganswer", screen: "wronganswer" }
    );
    return apply.nextMap;
  } catch (err) {
    const live = getWrongAnswerSession();
    if (
      attemptId === wrongAnswerVoteAttemptId &&
      canRollbackOptimisticSubmission(captured, live)
    ) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: live.votes,
        key: localName,
        hadPreviousValue: apply.hadPreviousValue,
        previousValue: apply.previousValue,
        optimisticValue: apply.optimisticValue,
        attemptId,
        currentAttemptId: wrongAnswerVoteAttemptId,
      });
      if (rolled.applied) {
        saveStatePatch({ wrongAnswerGame: { ...live, votes: rolled.map } });
      }
    }
    throw err;
  }
}

export function __resetWrongAnswerOptimisticAttemptsForTests() {
  wrongAnswerVoteAttemptId = 0;
  wrongAnswerAnswerAttemptId = 0;
}

export function hasLocalWrongAnswer(session = getWrongAnswerSession()) {
  const localName = getLocalDisplayName();
  return Boolean(session.answers?.[localName]?.text);
}

export function hasLocalWrongAnswerVote(session = getWrongAnswerSession()) {
  const localName = getLocalDisplayName();
  return session.votes?.[localName] != null;
}

export function allWrongAnswersIn(session = getWrongAnswerSession()) {
  const names = getActivePlayerNames();
  const answers = session.answers || {};
  return names.length > 0 && names.every((n) => Boolean(answers[n]?.text));
}

/** Tous les votants (= tous les joueurs) ont voté. */
export function allWrongAnswerVotesIn(session = getWrongAnswerSession()) {
  const names = getActivePlayerNames();
  const votes = session.votes || {};
  return names.length > 0 && names.every((n) => votes[n] != null);
}

export function getWrongAnswerEntryScreen() {
  const session = getWrongAnswerSession();
  if (!session.lobbyStarted) return "wronganswer-prep";
  return "wronganswer";
}
