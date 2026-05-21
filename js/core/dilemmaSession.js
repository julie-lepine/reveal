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
  pushGameSession,
  allMembersReady,
  dilemmaToRemote,
} from "./gameSync.js";
import { checkHotTakeModeration, getModerationNotice } from "./hotTakeSession.js";

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
    reactions: {},
    voteEndsAt: null,
    roundScored: false,
    blindMode: false,
    pausedBy: null,
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
  const local = getLobbyParticipants().find((p) => p.isLocal);
  return local?.isHost !== false;
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
  const fullDeck = [...bank, ...customs];
  const effective = resolveEffectiveRoundCount(session.roundCount ?? 8, fullDeck.length);
  const deck = shuffleArray(fullDeck).slice(0, effective);
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

/** Fusionne les listes custom (par id) — évite doublons et écrasements multijoueur. */
export function mergeCustomDilemmasLists(localList = [], remoteList = []) {
  const byId = new Map();
  [...localList, ...remoteList].forEach((raw) => {
    const d = normalizeCustomDilemma(raw);
    if (d) byId.set(d.id, d);
  });
  return [...byId.values()];
}

export async function addCustomDilemma(optionA, optionB) {
  const a = String(optionA || "").trim();
  const b = String(optionB || "").trim();
  if (!a || !b) return { ok: false, error: "Les deux options sont requises." };

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
  const merged = mergeCustomDilemmasLists(session.customDilemmas, [entry]);
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
  if (session.deck?.length) return session.deck;
  return buildDilemmaDeck();
}

function votingPayloadForRound(roundIdx, deck) {
  const dilemma = deck[roundIdx] || { optionA: "—", optionB: "—" };
  const endsAt = new Date(Date.now() + DILEMMA_VOTE_TIMER_SEC * 1000).toISOString();
  return {
    roundIdx,
    phase: "voting",
    currentDilemma: dilemma,
    votes: {},
    reactions: {},
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
  saveStatePatch({ dilemmaGame: next });
  if (isGameSyncActive() && isLobbyHost()) {
    await pushGameSession({
      screen: "dilemma",
      gameId: "dilemma",
      state: { dilemma: dilemmaToRemote(next) },
    });
  }
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

export async function setDilemmaReady(playerName, ready) {
  const session = getDilemmaSession();
  await syncDilemmaSession({
    ...session,
    ready: { ...session.ready, [playerName]: ready },
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

export async function commitDilemmaPlay(patch) {
  const session = { ...getDilemmaSession(), ...patch };
  await syncDilemmaSession(session);
  return session;
}

export async function setDilemmaPausedBy(name) {
  const session = getDilemmaSession();
  await syncDilemmaSession({ ...session, pausedBy: name });
}

export async function clearDilemmaPause() {
  const session = getDilemmaSession();
  await syncDilemmaSession({ ...session, pausedBy: null });
}

export function allDilemmaVotesIn() {
  const session = getDilemmaSession();
  const names = getActivePlayerNames();
  if (!names.length) return false;
  return names.every((n) => session.votes[n] === "A" || session.votes[n] === "B");
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
} from "../../data/dilemma.js";
