import {
  HOT_TAKE_THEMES,
  HOT_TAKE_CATALOG_ID,
  HOT_TAKE_MIX_ID,
  HOT_TAKE_FORBIDDEN_WORDS,
  HOT_TAKE_MODERATION_NOTICE,
  HOT_TAKE_ROUND_PRESETS,
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
  pushGameSession,
  allMembersReady,
  hotTakeToRemote,
} from "./gameSync.js";

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
    intermissionEndsAt: null,
    takeScored: false,
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
  if (typeof entry === "string") return { text: entry, author: null, themeId: null };
  return entry;
}

export async function setHotTakeTheme(themeId) {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, selectedThemeId: themeId, deck: null });
}

export function isLocalHotTakeHost() {
  const local = getLobbyParticipants().find((p) => p.isLocal);
  return local?.isHost !== false;
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

  const fullDeck = [...bank, ...customs];
  const effective = resolveEffectiveRoundCount(
    session.roundCount ?? 5,
    fullDeck.length
  );
  const deck = shuffleArray(fullDeck).slice(0, effective);
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
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Texte vide." };

  const mod = checkHotTakeModeration(trimmed);
  if (mod.blocked) return { ok: false, error: mod.message };

  const session = getHotTakeSession();
  const entry = { text: trimmed, author: getLocalDisplayName() };
  await syncHotTakeSession({
    ...session,
    customTakes: [...(session.customTakes || []), entry],
    deck: null,
  });
  return { ok: true };
}

export async function setHotTakeReady(playerName, ready) {
  const session = getHotTakeSession();
  await syncHotTakeSession({
    ...session,
    ready: { ...session.ready, [playerName]: ready },
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
  const session = getHotTakeSession();
  const next = {
    ...getHotTakeSession(),
    lobbyStarted: true,
    takeIdx: 0,
    phase: "question",
    votes: {},
    voteEndsAt: null,
    intermissionEndsAt: null,
  };
  saveStatePatch({ hotTakeGame: next });
  if (isGameSyncActive() && isLobbyHost()) {
    await pushGameSession({
      screen: "hottake",
      gameId: "hottake",
      state: { hotTake: hotTakeToRemote(next) },
    });
  }
}

export async function setHotTakePausedBy(name) {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, pausedBy: name });
}

export async function clearHotTakePause() {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, pausedBy: null });
}

export async function resetHotTakeSession() {
  await syncHotTakeSession(defaultSession());
}

export async function commitHotTakePlay(patch) {
  const session = { ...getHotTakeSession(), ...patch };
  await syncHotTakeSession(session);
  return session;
}

export function getHotTakeVotesForUi() {
  return getHotTakeSession().votes || {};
}

export function countHotTakeVotes() {
  return Object.keys(getHotTakeVotesForUi()).length;
}

export function allHotTakeVotesIn() {
  const session = getHotTakeSession();
  if (!isGameSyncActive()) return false;
  const remote = hotTakeToRemote(session);
  return Object.keys(remote.votes || {}).length >= getActivePlayerNames().length;
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
  let best = options[0];
  let max = -1;
  options.forEach((opt) => {
    if (counts[opt] > max) {
      max = counts[opt];
      best = opt;
    }
  });
  return { majority: best, counts };
}

export {
  HOT_TAKE_THEMES,
  HOT_TAKE_ROUND_PRESETS,
  HOT_TAKE_ROUND_ALL,
  HOT_TAKE_CATALOG_ID,
  HOT_TAKE_MIX_ID,
};
