import {
  isPlayerTextTooLong,
  playerTextMaxError,
  trimPlayerText,
} from "../../data/playerTextLimits.js";
import {
  HOT_TAKE_THEMES,
  HOT_TAKE_CATALOG_ID,
  HOT_TAKE_MIX_ID,
  HOT_TAKE_FORBIDDEN_WORDS,
  HOT_TAKE_MODERATION_NOTICE,
  HOT_TAKE_ROUND_PRESETS,
  HOT_TAKE_TIMER_SEC,
  getThemeBankTexts,
} from "../../data/hotTakes.js";
import {
  HOT_TAKE_ROUND_ALL,
  estimateHotTakeDuration,
  resolveEffectiveRoundCount,
} from "./hotTakeDuration.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  syncHotTakeSession,
  allMembersReady,
  hotTakeToRemote,
  patchGameState,
  requireLocalParticipantUid,
  normalizePlayerVotesMap,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { mergeHotTakeCustomTakes } from "./sessionMerge.js";

function defaultSession() {
  return {
    customTakes: [],
    ready: {},
    lobbyStarted: false,
    pausedBy: null,
    selectedThemeId: HOT_TAKE_CATALOG_ID,
    roundCount: 5,
    deck: null,
    takeIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    voteTimerRemaining: null,
    intermissionEndsAt: null,
    takeScored: false,
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

export function getHotTakeSession() {
  return getState().hotTakeGame || defaultSession();
}

export function getModerationNotice() {
  return HOT_TAKE_MODERATION_NOTICE;
}

function normalizeForModeration(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function checkHotTakeModeration(text) {
  const normalized = normalizeForModeration(text);
  const hit = HOT_TAKE_FORBIDDEN_WORDS.find((word) => {
    const w = normalizeForModeration(word);
    return w && normalized.includes(w);
  });
  if (hit) {
    return {
      blocked: true,
      message: `${HOT_TAKE_MODERATION_NOTICE} (terme interdit détecté.)`,
    };
  }
  return { blocked: false };
}

function normalizeTake(entry) {
  if (typeof entry === "string") {
    const text = trimPlayerText(entry);
    if (!text) return null;
    return { id: `legacy-${text.slice(0, 24)}`, text, author: null, themeId: null };
  }
  if (!entry || typeof entry !== "object") return null;
  const text = trimPlayerText(entry.text);
  if (!text) return null;
  return {
    id: entry.id || `custom-${text.slice(0, 24)}-${entry.author || "anon"}`,
    text,
    author: entry.author || null,
    themeId: entry.themeId || null,
  };
}

export async function setHotTakeTheme(themeId) {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, selectedThemeId: themeId, deck: null });
}

export function isLocalHotTakeHost() {
  return isLobbyHost();
}

export function getHotTakePoolSize() {
  const session = getHotTakeSession();
  const themeId = session.selectedThemeId || HOT_TAKE_CATALOG_ID;
  const bankLen = getThemeBankTexts(themeId).length;
  const customLen = (session.customTakes || []).length;
  return bankLen + customLen;
}

export function getHotTakeRoundCount() {
  const session = getHotTakeSession();
  return session.roundCount ?? 5;
}

export async function setHotTakeRoundCount(count) {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, roundCount: count, deck: null });
}

export function getHotTakePrepSummary() {
  const poolSize = getHotTakePoolSize();
  const requested = getHotTakeRoundCount();
  const effective = resolveEffectiveRoundCount(requested, poolSize);
  const duration = estimateHotTakeDuration(effective);
  return {
    poolSize,
    requested,
    effective,
    durationLabel: duration.label,
    capped: requested !== HOT_TAKE_ROUND_ALL && requested > poolSize,
  };
}

export function buildHotTakeDeck() {
  const session = getHotTakeSession();
  const themeId = session.selectedThemeId || HOT_TAKE_CATALOG_ID;
  const players = getActivePlayers();
  const names = players.map((p) => p.name);

  const bank = getThemeBankTexts(themeId).map((text, i) => ({
    text,
    author: names[i % names.length] || null,
    themeId,
  }));

  const customs = (session.customTakes || []).map(normalizeTake).map((t) => ({
    text: t.text,
    author: t.author || getLocalDisplayName(),
    themeId: "custom",
  }));

  const totalAvailable = bank.length + customs.length;
  const effective = resolveEffectiveRoundCount(
    session.roundCount ?? 5,
    totalAvailable
  );
  // Les takes des joueurs sont garanties (dans la limite des manches), le reste vient de la banque.
  const customsKept = shuffleArray(customs).slice(0, effective);
  const remaining = Math.max(0, effective - customsKept.length);
  const bankKept = shuffleArray(bank).slice(0, remaining);
  const deck = shuffleArray([...customsKept, ...bankKept]);
  const next = { ...session, deck };
  saveStatePatch({ hotTakeGame: next });
  return deck;
}

export function getAllTakesForGame() {
  const session = getHotTakeSession();
  if (session.deck?.length) return session.deck.map(normalizeTake);
  return buildHotTakeDeck();
}

/** Takes ajoutées par le joueur local (seules visibles en préparation). */
export function getMyCustomTakes() {
  const me = getLocalDisplayName();
  return (getHotTakeSession().customTakes || [])
    .map(normalizeTake)
    .filter((t) => (t.author || me) === me);
}

/** Nombre de takes custom des autres (texte masqué jusqu’à la manche). */
export function countOtherPlayersCustomTakes() {
  const me = getLocalDisplayName();
  return (getHotTakeSession().customTakes || [])
    .map(normalizeTake)
    .filter((t) => t.author && t.author !== me).length;
}

export async function addCustomTake(text) {
  if (isPlayerTextTooLong(text)) return { ok: false, error: playerTextMaxError() };
  const trimmed = trimPlayerText(text);
  if (!trimmed) return { ok: false, error: "Texte vide." };

  const mod = checkHotTakeModeration(trimmed);
  if (mod.blocked) return { ok: false, error: mod.message };

  const session = getHotTakeSession();
  const entry = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: trimmed,
    author: getLocalDisplayName(),
  };
  const merged = mergeHotTakeCustomTakes(
    [...(session.customTakes || []), entry],
    [],
    getLocalDisplayName()
  );
  await syncHotTakeSession({
    ...session,
    customTakes: merged,
    deck: null,
  });
  return { ok: true };
}

export async function removeCustomTake(takeId) {
  const me = getLocalDisplayName();
  const session = getHotTakeSession();
  const next = (session.customTakes || [])
    .map(normalizeTake)
    .filter(Boolean)
    .filter((t) => !(t.id === takeId && (t.author || me) === me));
  await syncHotTakeSession({ ...session, customTakes: next, deck: null });
  return { ok: true };
}

export async function setHotTakeReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getHotTakeSession,
    saveLocal: (session) => saveStatePatch({ hotTakeGame: session }),
    stateKey: "hotTake",
    gameId: "hottake",
    screen: "hottake-prep",
  });
}

export async function toggleLocalHotTakeReady() {
  const name = getLocalDisplayName();
  const session = getHotTakeSession();
  await setHotTakeReady(name, !session.ready[name]);
}

export function allHotTakeReady() {
  const session = getHotTakeSession();
  if (isGameSyncActive()) {
    const remote = hotTakeToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export async function resetHotTakeReady() {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, ready: {} });
}

export function simulateHotTakeReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    setHotTakeReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export async function markHotTakeLobbyStarted() {
  buildHotTakeDeck();
  const next = {
    ...getHotTakeSession(),
    lobbyStarted: true,
    takeIdx: 0,
    phase: "question",
    votes: {},
    voteEndsAt: null,
    intermissionEndsAt: null,
    matchScores: {},
    lastRound: null,
  };
  return launchGameWithSync({
    screen: "hottake",
    gameId: "hottake",
    mode: "push",
    beforeCommit: async () => {
      if (isGameSyncActive() && isLobbyHost()) {
        const { setLobbyPlaying } = await import("./lobby.js");
        await setLobbyPlaying("hottake");
      }
    },
    applyLocal: () => saveStatePatch({ hotTakeGame: next }),
    getRemoteState: () => ({ hotTake: hotTakeToRemote(next) }),
  });
}

export async function pauseHotTakeVote(pausedByName, remainingSec) {
  const session = getHotTakeSession();
  const rem = Math.max(0, Math.ceil(Number(remainingSec) || 0));
  await syncHotTakeSession({
    ...session,
    pausedBy: pausedByName,
    voteTimerRemaining: rem,
    voteEndsAt: null,
  });
}

export async function resumeHotTakeVote() {
  const session = getHotTakeSession();
  const rem = session.voteTimerRemaining ?? HOT_TAKE_TIMER_SEC;
  await syncHotTakeSession({
    ...session,
    pausedBy: null,
    voteTimerRemaining: null,
    voteEndsAt: new Date(Date.now() + rem * 1000).toISOString(),
  });
}

/** @deprecated Utiliser pauseHotTakeVote */
export async function setHotTakePausedBy(name) {
  const s = getHotTakeSession();
  let rem = HOT_TAKE_TIMER_SEC;
  if (s.voteEndsAt) {
    rem = Math.max(
      0,
      Math.ceil((new Date(s.voteEndsAt).getTime() - Date.now()) / 1000)
    );
  } else if (s.voteTimerRemaining != null) {
    rem = s.voteTimerRemaining;
  }
  return pauseHotTakeVote(name, rem);
}

/** @deprecated Utiliser resumeHotTakeVote */
export async function clearHotTakePause() {
  return resumeHotTakeVote();
}

export async function resetHotTakeSession() {
  await syncHotTakeSession(defaultSession());
}

/** Prep propre après une partie : garde thème / manches, efface customs et deck. */
export function hotTakePrepAfterGameReset() {
  const session = getHotTakeSession();
  return {
    ...defaultSession(),
    selectedThemeId: session.selectedThemeId || HOT_TAKE_CATALOG_ID,
    roundCount: session.roundCount ?? 5,
  };
}

/** Fin de partie : purge les takes custom pour tout le lobby. */
export async function resetHotTakeAfterGame({ syncRemote = true } = {}) {
  const next = hotTakePrepAfterGameReset();
  saveStatePatch({ hotTakeGame: next });
  if (syncRemote && isGameSyncActive() && isLobbyHost()) {
    await syncHotTakeSession(next);
  }
  return next;
}

export async function commitHotTakePlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "hottake",
    stateKey: "hotTake",
    getSession: getHotTakeSession,
    saveLocal: (session) => saveStatePatch({ hotTakeGame: session }),
    toRemote: hotTakeToRemote,
    patchOpts,
  });
}

/** Invité MP : envoie uniquement son vote (évite d'écraser phase reveal de l'hôte). */
export async function commitHotTakeVote(choice) {
  const localName = getLocalDisplayName();
  const session = getHotTakeSession();
  const uid = isGameSyncActive() ? requireLocalParticipantUid() : null;
  const votes = { ...(session.votes || {}), [localName]: choice };
  saveStatePatch({ hotTakeGame: { ...session, votes } });
  if (!isGameSyncActive()) return { ...session, votes };
  const remoteVotes = { [uid]: choice };
  if (localName && localName !== uid) {
    remoteVotes[localName] = choice;
  }
  await patchGameStateWithFeedback({ hotTake: { votes: remoteVotes } });
  return { ...session, votes };
}

export function getHotTakeVotesForUi() {
  return normalizePlayerVotesMap(getHotTakeSession().votes || {});
}

export function countHotTakeVotesCast(session = getHotTakeSession()) {
  const names = getActivePlayerNames();
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  return names.filter((name) => votes[name] != null && votes[name] !== "").length;
}

export function countHotTakeVotes() {
  return countHotTakeVotesCast();
}

export function allHotTakeVotesIn(session = getHotTakeSession()) {
  const names = getActivePlayerNames();
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  return names.length > 0 && names.every((name) => votes[name] != null && votes[name] !== "");
}

export function getHotTakeEntryScreen() {
  const session = getHotTakeSession();
  if (!session.lobbyStarted) return "hottake-prep";
  return "hottake";
}

/** Vote simultané simulé pour tout le lobby */
export function simulateLobbyVotes(localChoice, options) {
  const result = {};
  const local = getLocalDisplayName();
  result[local] = localChoice;

  getActivePlayerNames().forEach((name) => {
    if (name === local) return;
    const bias = Math.random() < 0.35 ? localChoice : null;
    result[name] =
      bias || options[Math.floor(Math.random() * options.length)];
  });
  return result;
}

export function getMajorityOption(votes, options) {
  const counts = options.reduce((acc, opt) => {
    acc[opt] = Object.values(votes).filter((v) => v === opt).length;
    return acc;
  }, {});
  let max = 0;
  options.forEach((opt) => {
    if (counts[opt] > max) max = counts[opt];
  });
  if (max === 0) {
    return { majority: null, tied: false, counts, maxVotes: 0 };
  }
  const leaders = options.filter((opt) => counts[opt] === max);
  if (leaders.length !== 1) {
    return { majority: null, tied: true, counts, maxVotes: max };
  }
  return { majority: leaders[0], tied: false, counts, maxVotes: max };
}

export {
  HOT_TAKE_THEMES,
  HOT_TAKE_ROUND_PRESETS,
  HOT_TAKE_ROUND_ALL,
  HOT_TAKE_CATALOG_ID,
  HOT_TAKE_MIX_ID,
};
