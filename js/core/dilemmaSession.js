import {
  DILEMMA_CATALOG_ID,
  DILEMMA_VOTE_TIMER_SEC,
  DILEMMA_ROUND_PRESETS,
  getDilemmaDeckItems,
} from "../../data/dilemma.js";
import {
  DILEMMA_ROUND_ALL,
  estimateDilemmaDuration,
  resolveEffectiveRoundCount,
} from "./dilemmaDuration.js";
import { getActivePlayerNames } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  syncDilemmaSession,
  allMembersReady,
  dilemmaToRemote,
  patchGameState,
  userIdForName,
  normalizePlayerVotesMap,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { checkHotTakeModeration, getModerationNotice } from "./hotTakeSession.js";
import { mergeDilemmaCustomDilemmas, mergeAuthorOwnedCustomList, normalizeDilemmaEntry } from "./sessionMerge.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    customDilemmas: [],
    selectedDeckId: DILEMMA_CATALOG_ID,
    roundCount: 8,
    deck: null,
    roundIdx: 0,
    phase: null,
    currentDilemma: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
    blindMode: false,
    pausedBy: null,
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

export function getDilemmaSession() {
  return getState().dilemmaGame || defaultSession();
}

export function defaultDilemmaPrepSession() {
  return defaultSession();
}

export function isLocalDilemmaHost() {
  return isLobbyHost();
}

export function normalizeCustomDilemma(entry) {
  if (!entry || typeof entry !== "object") return null;
  const optionA = String(entry.optionA || "").trim();
  const optionB = String(entry.optionB || "").trim();
  if (!optionA || !optionB) return null;
  return {
    id: entry.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    optionA,
    optionB,
    author: entry.author || null,
    tier: entry.tier || "custom",
  };
}

export { getModerationNotice };

export function getDilemmaPoolSize() {
  const session = getDilemmaSession();
  const deckId = session.selectedDeckId || DILEMMA_CATALOG_ID;
  const bankLen = getDilemmaDeckItems(deckId).length;
  const customLen = (session.customDilemmas || []).length;
  return bankLen + customLen;
}

export function getDilemmaRoundCount() {
  return getDilemmaSession().roundCount ?? 8;
}

export async function setDilemmaDeck(deckId) {
  const session = getDilemmaSession();
  await syncDilemmaSession({ ...session, selectedDeckId: deckId, deck: null });
}

export async function setDilemmaRoundCount(count) {
  const session = getDilemmaSession();
  await syncDilemmaSession({ ...session, roundCount: count, deck: null });
}

export function getDilemmaPrepSummary() {
  const poolSize = getDilemmaPoolSize();
  const requested = getDilemmaRoundCount();
  const effective = resolveEffectiveRoundCount(requested, poolSize);
  const duration = estimateDilemmaDuration(effective);
  return {
    poolSize,
    requested,
    effective,
    durationLabel: duration.label,
    capped: requested !== DILEMMA_ROUND_ALL && requested > poolSize,
  };
}

export function buildDilemmaDeck() {
  const session = getDilemmaSession();
  const deckId = session.selectedDeckId || DILEMMA_CATALOG_ID;
  const bank = getDilemmaDeckItems(deckId);
  const customs = (session.customDilemmas || [])
    .map(normalizeCustomDilemma)
    .filter(Boolean);
  const totalAvailable = bank.length + customs.length;
  const effective = resolveEffectiveRoundCount(session.roundCount ?? 8, totalAvailable);
  // Les dilemmes des joueurs en tête de partie (ordre aléatoire entre eux), puis la banque.
  const customsKept = shuffleArray(customs).slice(0, effective);
  const remaining = Math.max(0, effective - customsKept.length);
  const bankKept = shuffleArray(bank).slice(0, remaining);
  const deck = [...customsKept, ...bankKept];
  const next = { ...session, deck };
  saveStatePatch({ dilemmaGame: next });
  return deck;
}

/** Dilemmes ajoutés par le joueur local (visibles en préparation). */
export function getMyCustomDilemmas() {
  const me = getLocalDisplayName();
  return (getDilemmaSession().customDilemmas || [])
    .map(normalizeCustomDilemma)
    .filter(Boolean)
    .filter((d) => (d.author || me) === me);
}

/** Nombre de dilemmes custom des autres (masqués jusqu'à la manche). */
export function countOtherPlayersCustomDilemmas() {
  const me = getLocalDisplayName();
  return (getDilemmaSession().customDilemmas || [])
    .map(normalizeCustomDilemma)
    .filter(Boolean)
    .filter((d) => d.author && d.author !== me).length;
}

/** Fusionne les listes custom (par id) - usage local uniquement. */
export function mergeCustomDilemmasLists(localList = [], remoteList = []) {
  return mergeAuthorOwnedCustomList(localList, remoteList, {
    normalize: normalizeDilemmaEntry,
    localAuthor: getLocalDisplayName(),
  });
}

export function isCustomDilemmaEntry(dilemma) {
  if (!dilemma || typeof dilemma !== "object") return false;
  if (dilemma.tier === "custom" || dilemma.author) return true;
  const id = String(dilemma.id || "");
  return id.startsWith("custom-");
}

/** Retire un dilemme custom joué (one-shot) ; sync distante si hôte MP. */
export async function consumePlayedCustomDilemma(dilemma) {
  if (!isCustomDilemmaEntry(dilemma) || !dilemma.id) return false;
  const session = getDilemmaSession();
  const prev = session.customDilemmas || [];
  const next = prev
    .map(normalizeCustomDilemma)
    .filter(Boolean)
    .filter((d) => d.id !== dilemma.id);
  if (next.length === prev.length) return false;
  if (isGameSyncActive() && isLobbyHost()) {
    await syncDilemmaSession({ ...session, customDilemmas: next });
  } else {
    saveStatePatch({ dilemmaGame: { ...session, customDilemmas: next } });
  }
  return true;
}

export async function addCustomDilemma(optionA, optionB) {
  const a = String(optionA || "").trim();
  const b = String(optionB || "").trim();
  if (!a || !b) return { ok: false, error: "Les deux options sont requises." };

  if (getMyCustomDilemmas().length >= 1) {
    return { ok: false, error: "Tu as déjà soumis un dilemme pour cette partie." };
  }

  const modA = checkHotTakeModeration(a);
  if (modA.blocked) return { ok: false, error: modA.message };
  const modB = checkHotTakeModeration(b);
  if (modB.blocked) return { ok: false, error: modB.message };

  const session = getDilemmaSession();
  const entry = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    optionA: a,
    optionB: b,
    author: getLocalDisplayName(),
    tier: "custom",
  };
  const merged = mergeDilemmaCustomDilemmas(
    [...(session.customDilemmas || []), entry],
    [],
    getLocalDisplayName()
  );
  await syncDilemmaSession({
    ...session,
    customDilemmas: merged,
    deck: null,
  });
  return { ok: true };
}

export async function removeCustomDilemma(dilemmaId) {
  const me = getLocalDisplayName();
  const session = getDilemmaSession();
  const next = (session.customDilemmas || [])
    .map(normalizeCustomDilemma)
    .filter(Boolean)
    .filter((d) => !(d.id === dilemmaId && (d.author || me) === me));
  await syncDilemmaSession({ ...session, customDilemmas: next, deck: null });
  return { ok: true };
}

export function getDilemmaRounds() {
  const session = getDilemmaSession();
  if (session.lobbyStarted && session.deck?.length) return session.deck;
  return buildDilemmaDeck();
}

function votingPayloadForRound(roundIdx, deck) {
  const dilemma = deck[roundIdx] || { optionA: "-", optionB: "-" };
  const endsAt = new Date(Date.now() + DILEMMA_VOTE_TIMER_SEC * 1000).toISOString();
  return {
    roundIdx,
    phase: "voting",
    currentDilemma: dilemma,
    votes: {},
    voteEndsAt: endsAt,
    roundScored: false,
    pausedBy: null,
  };
}

export async function markDilemmaLobbyStarted() {
  const deck = buildDilemmaDeck();
  const next = {
    ...getDilemmaSession(),
    lobbyStarted: true,
    ...votingPayloadForRound(0, deck),
  };
  return launchGameWithSync({
    screen: "dilemma",
    gameId: "dilemma",
    mode: "push",
    beforeCommit: async () => {
      if (isGameSyncActive() && isLobbyHost()) {
        const { setLobbyPlaying } = await import("./lobby.js");
        await setLobbyPlaying("dilemma");
      }
    },
    applyLocal: () => saveStatePatch({ dilemmaGame: next }),
    getRemoteState: () => ({ dilemma: dilemmaToRemote(next) }),
  });
}

export async function startDilemmaRound(roundIdx) {
  const deck = getDilemmaRounds();
  const next = {
    ...getDilemmaSession(),
    ...votingPayloadForRound(roundIdx, deck),
  };
  await syncDilemmaSession(next);
  return next;
}

export async function resetDilemmaReady() {
  const session = getDilemmaSession();
  await syncDilemmaSession({ ...session, ready: {} });
}

/** Prep propre après une partie : garde deck / manches, efface customs. */
export function dilemmaPrepAfterGameReset() {
  const session = getDilemmaSession();
  return {
    ...defaultSession(),
    selectedDeckId: session.selectedDeckId || DILEMMA_CATALOG_ID,
    roundCount: session.roundCount ?? 8,
  };
}

/** Fin de partie : purge les dilemmes custom pour tout le lobby. */
export async function resetDilemmaAfterGame({ syncRemote = true } = {}) {
  const next = dilemmaPrepAfterGameReset();
  saveStatePatch({ dilemmaGame: next });
  if (syncRemote && isGameSyncActive() && isLobbyHost()) {
    await syncDilemmaSession(next);
  }
  return next;
}

export async function setDilemmaReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getDilemmaSession,
    saveLocal: (session) => saveStatePatch({ dilemmaGame: session }),
    stateKey: "dilemma",
    gameId: "dilemma",
    screen: "dilemma-prep",
  });
}

export async function toggleLocalDilemmaReady() {
  const name = getLocalDisplayName();
  const session = getDilemmaSession();
  await setDilemmaReady(name, !session.ready[name]);
}

export function allDilemmaReady() {
  const session = getDilemmaSession();
  if (isGameSyncActive()) {
    const remote = dilemmaToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export function simulateDilemmaReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    setDilemmaReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export async function commitDilemmaPlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "dilemma",
    stateKey: "dilemma",
    getSession: getDilemmaSession,
    saveLocal: (session) => saveStatePatch({ dilemmaGame: session }),
    toRemote: dilemmaToRemote,
    patchOpts,
  });
}

/** Invité MP : envoie uniquement son vote (évite d'écraser phase reveal de l'hôte). */
export async function commitDilemmaVote(choice) {
  const localName = getLocalDisplayName();
  const session = getDilemmaSession();
  const votes = { ...(session.votes || {}), [localName]: choice };
  saveStatePatch({ dilemmaGame: { ...session, votes } });
  if (!isGameSyncActive()) return { ...session, votes };
  const uid = userIdForName(localName) || localName;
  await patchGameStateWithFeedback({ dilemma: { votes: { [uid]: choice } } });
  return { ...session, votes };
}

export async function setDilemmaPausedBy(name) {
  const session = getDilemmaSession();
  await syncDilemmaSession({ ...session, pausedBy: name });
}

export async function clearDilemmaPause() {
  const session = getDilemmaSession();
  await syncDilemmaSession({ ...session, pausedBy: null });
}

export function allDilemmaVotesIn(session = getDilemmaSession()) {
  const names = getActivePlayerNames();
  if (!names.length) return false;
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  return names.every((n) => votes[n] === "A" || votes[n] === "B");
}

export function getDilemmaEntryScreen() {
  const session = getDilemmaSession();
  if (!session.lobbyStarted) return "dilemma-prep";
  return "dilemma";
}

export function countDilemmaResults(votes) {
  let countA = 0;
  let countB = 0;
  Object.values(votes).forEach((v) => {
    if (v === "A") countA += 1;
    else if (v === "B") countB += 1;
  });
  const total = countA + countB;
  const pctA = total ? Math.round((countA / total) * 100) : 50;
  const pctB = total ? 100 - pctA : 50;
  const majority = countA === countB ? null : countA > countB ? "A" : "B";
  const divided = total > 0 && Math.abs(pctA - 50) <= 8;
  return { countA, countB, total, pctA, pctB, majority, divided };
}

export function simulateDilemmaLobbyVotes(localChoice) {
  const result = {};
  const local = getLocalDisplayName();
  result[local] = localChoice;
  getActivePlayerNames().forEach((name) => {
    if (name === local) return;
    result[name] = Math.random() < 0.5 ? "A" : "B";
  });
  return result;
}

export {
  DILEMMA_DECKS,
  DILEMMA_ROUND_PRESETS,
  DILEMMA_ROUND_ALL,
  DILEMMA_CATALOG_ID,
  DILEMMA_VOTE_TIMER_SEC,
  DILEMMA_POINTS_MAJORITY_WIN,
  DILEMMA_POINTS_TIE,
} from "../../data/dilemma.js";
