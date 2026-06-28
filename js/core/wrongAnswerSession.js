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
  userIdForName,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { checkHotTakeModeration } from "./hotTakeSession.js";

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

/** MP : envoie uniquement la réponse locale ({ text, at }). Première réponse conservée. */
export async function commitWrongAnswerAnswer(text) {
  const localName = getLocalDisplayName();
  const session = getWrongAnswerSession();
  if (session.answers?.[localName]?.text) {
    return session.answers[localName];
  }
  const cleanText = sanitizeWrongAnswer(text);
  if (!cleanText || checkHotTakeModeration(cleanText).blocked) return null;
  const answer = { text: cleanText, at: Date.now() };
  const answers = { ...(session.answers || {}), [localName]: answer };
  saveStatePatch({ wrongAnswerGame: { ...session, answers } });
  if (!isGameSyncActive()) return answer;
  const uid = userIdForName(localName) || localName;
  await patchGameStateWithFeedback(
    { wrongAnswer: { answers: { [uid]: answer } } },
    { gameId: "wronganswer", screen: "wronganswer" }
  );
  return answer;
}

/** MP : envoie uniquement le vote local (auteur de la pire réponse). */
export async function commitWrongAnswerVote(targetName) {
  const localName = getLocalDisplayName();
  const session = getWrongAnswerSession();
  const votes = { ...(session.votes || {}), [localName]: targetName };
  saveStatePatch({ wrongAnswerGame: { ...session, votes } });
  if (!isGameSyncActive()) return votes;
  const uid = userIdForName(localName) || localName;
  const targetUid = userIdForName(targetName) || targetName;
  await patchGameStateWithFeedback(
    { wrongAnswer: { votes: { [uid]: targetUid } } },
    { gameId: "wronganswer", screen: "wronganswer" }
  );
  return votes;
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
