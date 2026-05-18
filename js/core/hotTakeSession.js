import {
  HOT_TAKE_THEMES,
  HOT_TAKE_CATALOG_ID,
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

function defaultSession() {
  return {
    customTakes: [],
    ready: {},
    lobbyStarted: false,
    pausedBy: null,
    selectedThemeId: HOT_TAKE_CATALOG_ID,
    roundCount: 5,
    deck: null,
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

export function setHotTakeTheme(themeId) {
  const session = getHotTakeSession();
  saveStatePatch({
    hotTakeGame: { ...session, selectedThemeId: themeId, deck: null },
  });
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

export function setHotTakeRoundCount(count) {
  const session = getHotTakeSession();
  saveStatePatch({
    hotTakeGame: { ...session, roundCount: count, deck: null },
  });
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
  saveStatePatch({ hotTakeGame: { ...session, deck } });
  return deck;
}

export function getAllTakesForGame() {
  const session = getHotTakeSession();
  if (session.deck?.length) return session.deck.map(normalizeTake);
  return buildHotTakeDeck();
}

export function addCustomTake(text) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Texte vide." };

  const mod = checkHotTakeModeration(trimmed);
  if (mod.blocked) return { ok: false, error: mod.message };

  const session = getHotTakeSession();
  const entry = { text: trimmed, author: getLocalDisplayName() };
  saveStatePatch({
    hotTakeGame: {
      ...session,
      customTakes: [...(session.customTakes || []), entry],
      deck: null,
    },
  });
  return { ok: true };
}

export function setHotTakeReady(playerName, ready) {
  const session = getHotTakeSession();
  saveStatePatch({
    hotTakeGame: {
      ...session,
      ready: { ...session.ready, [playerName]: ready },
    },
  });
}

export function toggleLocalHotTakeReady() {
  const name = getLocalDisplayName();
  const session = getHotTakeSession();
  setHotTakeReady(name, !session.ready[name]);
}

export function allHotTakeReady() {
  const session = getHotTakeSession();
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export function resetHotTakeReady() {
  const session = getHotTakeSession();
  saveStatePatch({ hotTakeGame: { ...session, ready: {} } });
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

export function markHotTakeLobbyStarted() {
  buildHotTakeDeck();
  const session = getHotTakeSession();
  saveStatePatch({ hotTakeGame: { ...session, lobbyStarted: true } });
}

export function setHotTakePausedBy(name) {
  const session = getHotTakeSession();
  saveStatePatch({ hotTakeGame: { ...session, pausedBy: name } });
}

export function clearHotTakePause() {
  const session = getHotTakeSession();
  saveStatePatch({ hotTakeGame: { ...session, pausedBy: null } });
}

export function resetHotTakeSession() {
  saveStatePatch({ hotTakeGame: defaultSession() });
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
};
