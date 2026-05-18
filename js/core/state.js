import { scheduleSave } from "./persist.js";

const STORAGE_KEY = "reveal-app-state";

const emptyGuessLie = () => ({
  sessionId: null,
  submissions: {},
  lobbyComplete: false,
  currentRound: 0,
});

const defaultGlobalStats = () => ({
  lobbiesCreated: 0,
  hotTakesPlayed: 0,
  liesFound: 0,
  playersJoined: 0,
});

const defaultUser = () => ({
  email: null,
  name: null,
  loggedIn: false,
  isGuest: false,
  provider: null,
});

const defaultLobby = () => ({
  code: null,
  participants: [],
  messages: [],
  status: "waiting",
  gameId: null,
});

export const defaultPlayerStats = () => ({
  hotTakeMajorityWins: 0,
  hotTakeDissentWins: 0,
  liesDetected: 0,
  liesFooled: 0,
  tierConsensusPoints: 0,
  tierNightsPlayed: 0,
});

const defaultState = () => ({
  scores: {},
  playerStats: {},
  stats: {
    hotTakesPlayed: 0,
    liesFound: 0,
    liesTotal: 0,
    tierNightsPlayed: 0,
  },
  globalStats: defaultGlobalStats(),
  user: defaultUser(),
  lobby: defaultLobby(),
  inLobby: false,
  lobbyCode: generateLobbyCode(),
  lastGame: null,
  guessLie: emptyGuessLie(),
  tierNightTopicId: null,
  customTierLists: [],
  hotTakeGame: {
    customTakes: [],
    ready: {},
    lobbyStarted: false,
    pausedBy: null,
    selectedThemeId: "catalog",
    roundCount: 5,
    deck: null,
  },
  tierNightGame: { recaps: [], topicId: null, listName: "", controversialItem: null },
  openLobbies: {},
});

function generateLobbyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    const merged = {
      ...base,
      ...parsed,
      scores: { ...base.scores, ...parsed.scores },
      playerStats: { ...base.playerStats, ...parsed.playerStats },
      stats: { ...base.stats, ...parsed.stats },
      guessLie: { ...emptyGuessLie(), ...parsed.guessLie },
      customTierLists: parsed.customTierLists || [],
      globalStats: { ...defaultGlobalStats(), ...parsed.globalStats },
      user: { ...defaultUser(), ...parsed.user },
      lobby: { ...defaultLobby(), ...parsed.lobby },
      inLobby: parsed.inLobby || false,
      hotTakeGame: { ...defaultState().hotTakeGame, ...parsed.hotTakeGame },
      tierNightGame: { ...defaultState().tierNightGame, ...parsed.tierNightGame },
      openLobbies: parsed.openLobbies || {},
      lastGame: parsed.lastGame || null,
    };
    if (!merged.guessLie.sessionId) {
      merged.guessLie.sessionId = merged.lobbyCode;
    }
    if (!merged.lobby.status) merged.lobby.status = "waiting";
    return merged;
  } catch {
    return defaultState();
  }
}

let state = loadState();

function saveNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

function save() {
  scheduleSave(saveNow);
}

export function saveStatePatch(patch) {
  state = { ...state, ...patch };
  if (patch.lobby) state.lobby = { ...state.lobby, ...patch.lobby };
  if (patch.user) state.user = { ...state.user, ...patch.user };
  if (patch.globalStats) state.globalStats = { ...state.globalStats, ...patch.globalStats };
  if (patch.playerStats) state.playerStats = { ...state.playerStats, ...patch.playerStats };
  save();
}

export function getState() {
  return state;
}

export const LOCAL_PLAYER = "Toi";

export function getLocalDisplayName() {
  const name = state.user?.name?.trim();
  return name || LOCAL_PLAYER;
}

export function ensurePlayerScore(playerName) {
  if (!playerName) return;
  if (state.scores[playerName] === undefined) {
    state.scores[playerName] = 0;
    save();
  }
  if (!state.playerStats[playerName]) {
    state.playerStats[playerName] = defaultPlayerStats();
    save();
  }
}

export function ensurePlayerStats(playerName) {
  ensurePlayerScore(playerName);
  return state.playerStats[playerName];
}

export function bumpPlayerStat(playerName, key, amount = 1) {
  const ps = ensurePlayerStats(playerName);
  ps[key] = (ps[key] || 0) + amount;
  save();
}

export function resetScores() {
  Object.keys(state.scores).forEach((name) => {
    state.scores[name] = 0;
    state.playerStats[name] = defaultPlayerStats();
  });
  save();
}

export function addScore(playerName, points) {
  ensurePlayerScore(playerName);
  state.scores[playerName] += points;
  save();
}

export function addLocalScore(points) {
  addScore(getLocalDisplayName(), points);
}

export function setLastGame(result) {
  state.lastGame = { ...result, at: Date.now() };
  save();
}

export function getLastGame() {
  return state.lastGame;
}

export function recordHotTakePlayed() {
  state.stats.hotTakesPlayed += 1;
  state.globalStats.hotTakesPlayed = (state.globalStats.hotTakesPlayed || 0) + 1;
  save();
}

export function recordTierNightPlayed() {
  state.stats.tierNightsPlayed = (state.stats.tierNightsPlayed || 0) + 1;
  save();
}

export function recordLieGuess(correct) {
  state.stats.liesTotal += 1;
  if (correct) {
    state.stats.liesFound += 1;
    state.globalStats.liesFound = (state.globalStats.liesFound || 0) + 1;
  }
  save();
}

export function getLieSuccessRate() {
  const { liesFound, liesTotal } = state.stats;
  if (liesTotal === 0) return "—";
  return `${Math.round((liesFound / liesTotal) * 100)}%`;
}

export function newLobby() {
  state.lobbyCode = generateLobbyCode();
  state.guessLie = emptyGuessLie();
  state.guessLie.sessionId = state.lobbyCode;
  save();
  return state.lobbyCode;
}

export function getGlobalStats() {
  return state.globalStats;
}

function syncGuessLieSession() {
  if (state.guessLie.sessionId !== state.lobbyCode) {
    state.guessLie = emptyGuessLie();
    state.guessLie.sessionId = state.lobbyCode;
    save();
  }
}

export function setLocalGuessLieSubmission(statements, lieIndex) {
  syncGuessLieSession();
  const name = getLocalDisplayName();
  ensurePlayerScore(name);
  state.guessLie.submissions[name] = {
    statements: statements.map((s) => s.trim()),
    lie: lieIndex,
  };
  save();
}

export function setGuessLieSubmission(playerName, payload) {
  syncGuessLieSession();
  ensurePlayerScore(playerName);
  state.guessLie.submissions[playerName] = payload;
  save();
}

export function markGuessLieLobbyComplete() {
  syncGuessLieSession();
  state.guessLie.lobbyComplete = true;
  save();
}

export function resetGuessLieSession() {
  syncGuessLieSession();
  state.guessLie = { ...emptyGuessLie(), sessionId: state.lobbyCode };
  save();
}

export function setTierNightTopicId(id) {
  state.tierNightTopicId = id;
  save();
}

export function getTierNightTopicId() {
  return state.tierNightTopicId;
}

export function addCustomTierList({ name, items, emoji = "✨" }) {
  const id = `custom-${Date.now()}`;
  const list = {
    id,
    name: name.trim(),
    logo: "",
    emoji: emoji || "✨",
    items,
    custom: true,
  };
  state.customTierLists = [...(state.customTierLists || []), list];
  state.tierNightTopicId = id;
  save();
  return id;
}
