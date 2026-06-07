import { scheduleSave } from "./persist.js";
import { DEFAULT_PROFILE_EMOJI } from "../../data/profileEmojis.js";

const STORAGE_KEY = "reveal-app-state";

const emptyGuessLie = () => ({
  sessionId: null,
  submissions: {},
  lobbyComplete: false,
  currentRound: 0,
  roundIdx: 0,
  phase: null,
  votes: {},
  roundScored: false,
  statsRecordedRoundIdx: -1,
});

const defaultGlobalStats = () => ({
  lobbiesCreated: 0,
  hotTakesPlayed: 0,
  liesFound: 0,
  playersJoined: 0,
});

const GUEST_FALLBACK_EMOJIS = ["🎭", "🎪", "🎲", "🃏", "🎯", "🌟", "🎈", "🎊"];

const defaultUser = () => ({
  email: null,
  name: null,
  emoji: null,
  loggedIn: false,
  isGuest: false,
  provider: null,
});

const defaultLobby = () => ({
  id: null,
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
  truthMeterBluffWins: 0,
  truthMeterMindReaderWins: 0,
  filRougeMissionsValidated: 0,
});

const defaultSettings = () => ({
  timerMuted: false,
});

const defaultState = () => ({
  supabaseUserId: null,
  settings: defaultSettings(),
  scores: {},
  filRougeScores: {},
  /** Points par jeu : { [gameId]: { [playerName]: points } } (agrégé sur la soirée). */
  gameScores: {},
  /** Snapshot gameScores au démarrage de la partie en cours (affichage in-game). */
  gameScoreSessionBaseline: {},
  gameScoreSessionGameId: null,
  /** Ordre de passage des jeux pour l'affichage des classements. */
  gameScoreOrder: [],
  playerStats: {},
  stats: {
    hotTakesPlayed: 0,
    speedVotesPlayed: 0,
    playlistGuessesPlayed: 0,
    truthMetersPlayed: 0,
    consensusGamesPlayed: 0,
    dilemmasPlayed: 0,
    triviaGamesPlayed: 0,
    traitreGamesPlayed: 0,
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
  /** Jeux déjà comptés dans stats.eveningGamesRecorded (évite double record*Played). */
  eveningGamesRecorded: {},
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
    takeIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    intermissionEndsAt: null,
    takeScored: false,
  },
  speedVoteGame: {
    ready: {},
    lobbyStarted: false,
    selectedThemeId: "catalog",
    roundCount: 5,
    deck: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
    modifier: "normal",
    currentQuestion: null,
  },
  traitreGame: {
    ready: {},
    lobbyStarted: false,
    phase: null,
    pairId: null,
    impostorName: null,
    speakRound: 1,
    speakerIndex: 0,
    alive: [],
    eliminated: [],
    votes: {},
    revotePending: false,
    revoteCount: 0,
    voteSurvivals: 0,
    dealAcks: {},
    lastVoteSnapshot: null,
    lastEliminated: null,
    impostorRevealed: false,
    winner: null,
    scoresApplied: false,
    lastRound: null,
  },
  playlistGuessGame: {
    ready: {},
    lobbyStarted: false,
    roundCount: 5,
    deck: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
  },
  truthMeterGame: {
    ready: {},
    lobbyStarted: false,
    authorOrder: [],
    roundIdx: 0,
    phase: null,
    affirmation: null,
    authorEstimate: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
  },
  consensusGame: {
    ready: {},
    lobbyStarted: false,
    selectedModeId: "standard",
    questionCount: 5,
    deck: null,
    questionIdx: 0,
    phase: null,
    currentQuestion: null,
    answers: {},
    roundScored: false,
    matchScores: {},
    lastRound: null,
    podiumApplied: false,
  },
  dilemmaGame: {
    ready: {},
    lobbyStarted: false,
    customDilemmas: [],
    selectedDeckId: "catalog",
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
  },
  triviaGame: {
    ready: {},
    lobbyStarted: false,
    selectedThemeId: "random",
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
  },
  filRougeGame: {
    status: "idle",
    submissions: {},
    missionAcks: {},
    validations: {},
    resultsModalOpen: false,
    resultsSnapshot: null,
    closedAt: null,
    closedByUid: null,
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
      filRougeScores: { ...base.filRougeScores, ...parsed.filRougeScores },
      gameScores: { ...base.gameScores, ...parsed.gameScores },
      gameScoreSessionBaseline: {
        ...base.gameScoreSessionBaseline,
        ...parsed.gameScoreSessionBaseline,
      },
      gameScoreSessionGameId: parsed.gameScoreSessionGameId ?? null,
      gameScoreOrder: Array.isArray(parsed.gameScoreOrder) ? parsed.gameScoreOrder : [],
      playerStats: { ...base.playerStats, ...parsed.playerStats },
      stats: { ...base.stats, ...parsed.stats },
      guessLie: { ...emptyGuessLie(), ...parsed.guessLie },
      customTierLists: parsed.customTierLists || [],
      globalStats: { ...defaultGlobalStats(), ...parsed.globalStats },
      user: { ...defaultUser(), ...parsed.user },
      lobby: { ...defaultLobby(), ...parsed.lobby },
      inLobby: parsed.inLobby || false,
      hotTakeGame: { ...defaultState().hotTakeGame, ...parsed.hotTakeGame },
      speedVoteGame: { ...defaultState().speedVoteGame, ...parsed.speedVoteGame },
      traitreGame: { ...defaultState().traitreGame, ...parsed.traitreGame },
      playlistGuessGame: { ...defaultState().playlistGuessGame, ...parsed.playlistGuessGame },
      truthMeterGame: { ...defaultState().truthMeterGame, ...parsed.truthMeterGame },
      consensusGame: { ...defaultState().consensusGame, ...parsed.consensusGame },
      dilemmaGame: { ...defaultState().dilemmaGame, ...parsed.dilemmaGame },
      triviaGame: { ...defaultState().triviaGame, ...parsed.triviaGame },
      filRougeGame: { ...defaultState().filRougeGame, ...parsed.filRougeGame },
      tierNightGame: { ...defaultState().tierNightGame, ...parsed.tierNightGame },
      openLobbies: parsed.openLobbies || {},
      lastGame: parsed.lastGame || null,
      settings: { ...defaultSettings(), ...parsed.settings },
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
  if (patch.filRougeScores) {
    state.filRougeScores = { ...state.filRougeScores, ...patch.filRougeScores };
  }
  if (patch.gameScores) state.gameScores = { ...state.gameScores, ...patch.gameScores };
  if (patch.playerStats) state.playerStats = { ...state.playerStats, ...patch.playerStats };
  if (patch.settings) state.settings = { ...state.settings, ...patch.settings };
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

function guestEmojiFromName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % GUEST_FALLBACK_EMOJIS.length;
  return GUEST_FALLBACK_EMOJIS[h];
}

export function getLocalEmoji() {
  const custom = state.user?.emoji?.trim();
  if (custom) return [...custom][0] || custom;
  if (state.user?.isGuest) return guestEmojiFromName(getLocalDisplayName());
  return DEFAULT_PROFILE_EMOJI;
}

export function setLocalEmoji(emoji) {
  const graphemes = [...emoji.trim()];
  if (!graphemes.length) {
    return { ok: false, error: "Choisis un emoji." };
  }
  const chosen = graphemes.slice(0, 2).join("");

  state.user = { ...state.user, emoji: chosen };

  if (state.lobby?.participants?.length) {
    state.lobby = {
      ...state.lobby,
      participants: state.lobby.participants.map((p) =>
        p.isLocal ? { ...p, emoji: chosen } : p
      ),
    };
  }

  save();
  return { ok: true, emoji: chosen };
}

function mergeKeyedRecord(record, oldKey, newKey) {
  if (!record || oldKey === newKey || record[oldKey] === undefined) return record;
  const next = { ...record };
  if (next[newKey] !== undefined) {
    if (typeof next[newKey] === "object" && next[newKey] !== null && typeof next[oldKey] === "object") {
      next[newKey] = { ...next[oldKey], ...next[newKey] };
    }
  } else {
    next[newKey] = next[oldKey];
  }
  delete next[oldKey];
  return next;
}

/** Renomme le joueur local (scores, lobby, sessions). */
export function renameLocalPlayer(newName) {
  const trimmed = newName.trim().slice(0, 24);
  if (trimmed.length < 2) {
    return { ok: false, error: "Le pseudo doit faire au moins 2 caractères." };
  }

  const oldName = getLocalDisplayName();
  if (oldName === trimmed) return { ok: true, name: trimmed };

  state.scores = mergeKeyedRecord(state.scores, oldName, trimmed);
  state.filRougeScores = mergeKeyedRecord(state.filRougeScores, oldName, trimmed);
  state.playerStats = mergeKeyedRecord(state.playerStats, oldName, trimmed);

  if (state.guessLie?.submissions) {
    state.guessLie.submissions = mergeKeyedRecord(state.guessLie.submissions, oldName, trimmed);
  }

  const ht = state.hotTakeGame;
  if (ht) {
    if (ht.ready) ht.ready = mergeKeyedRecord(ht.ready, oldName, trimmed);
    if (ht.votes) ht.votes = mergeKeyedRecord(ht.votes, oldName, trimmed);
    if (ht.pausedBy === oldName) ht.pausedBy = trimmed;
    if (Array.isArray(ht.customTakes)) {
      ht.customTakes = ht.customTakes.map((t) =>
        t?.author === oldName ? { ...t, author: trimmed } : t
      );
    }
  }

  const dm = state.dilemmaGame;
  if (dm) {
    if (dm.ready) dm.ready = mergeKeyedRecord(dm.ready, oldName, trimmed);
    if (dm.votes) dm.votes = mergeKeyedRecord(dm.votes, oldName, trimmed);
    if (dm.pausedBy === oldName) dm.pausedBy = trimmed;
    if (Array.isArray(dm.customDilemmas)) {
      dm.customDilemmas = dm.customDilemmas.map((d) =>
        d?.author === oldName ? { ...d, author: trimmed } : d
      );
    }
  }

  const consensus = state.consensusGame;
  if (consensus) {
    if (consensus.ready) consensus.ready = mergeKeyedRecord(consensus.ready, oldName, trimmed);
    if (consensus.answers) consensus.answers = mergeKeyedRecord(consensus.answers, oldName, trimmed);
    if (consensus.matchScores) {
      consensus.matchScores = mergeKeyedRecord(consensus.matchScores, oldName, trimmed);
    }
    if (consensus.lastRound?.deltas) {
      consensus.lastRound.deltas = mergeKeyedRecord(consensus.lastRound.deltas, oldName, trimmed);
    }
  }

  if (Array.isArray(state.tierNightGame?.recaps)) {
    state.tierNightGame.recaps = state.tierNightGame.recaps.map((r) =>
      r?.player === oldName ? { ...r, player: trimmed } : r
    );
  }

  if (state.lobby?.participants?.length) {
    state.lobby = {
      ...state.lobby,
      participants: state.lobby.participants.map((p) =>
        p.isLocal ? { ...p, name: trimmed, emoji: p.isHost ? p.emoji : p.emoji } : p
      ),
    };
  }

  if (state.user) {
    state.user = { ...state.user, name: trimmed };
  }

  save();
  return { ok: true, name: trimmed };
}

export function ensurePlayerScore(playerName) {
  if (!playerName) return;
  if (state.scores[playerName] === undefined) {
    state.scores[playerName] = 0;
    save();
  }
  if (state.filRougeScores[playerName] === undefined) {
    state.filRougeScores[playerName] = 0;
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
  const names = new Set([
    ...Object.keys(state.scores),
    ...Object.keys(state.filRougeScores),
  ]);
  names.forEach((name) => {
    state.scores[name] = 0;
    state.filRougeScores[name] = 0;
    state.playerStats[name] = defaultPlayerStats();
  });
  state.gameScores = {};
  state.gameScoreOrder = [];
  state.gameScoreSessionBaseline = {};
  state.gameScoreSessionGameId = null;
  save();
}

export function defaultEveningStats() {
  return {
    hotTakesPlayed: 0,
    liesFound: 0,
    liesTotal: 0,
    tierNightsPlayed: 0,
    speedVotesPlayed: 0,
    playlistGuessesPlayed: 0,
    truthMetersPlayed: 0,
    consensusGamesPlayed: 0,
    dilemmasPlayed: 0,
    triviaGamesPlayed: 0,
    traitreGamesPlayed: 0,
  };
}

/** Scores + stats de soirée + état des jeux - nouvelle partie / lobby. */
export function resetEveningState() {
  resetScores();
  resetGameSessionsOnly();
  saveStatePatch({ stats: defaultEveningStats(), eveningGamesRecorded: {} });
}

/** Remet à zéro les sessions de jeu sans effacer le classement de la soirée. */
export function resetGameSessionsOnly() {
  const base = defaultState();
  saveStatePatch({
    hotTakeGame: { ...base.hotTakeGame },
    speedVoteGame: { ...base.speedVoteGame },
    traitreGame: { ...base.traitreGame },
    playlistGuessGame: { ...base.playlistGuessGame },
    truthMeterGame: { ...base.truthMeterGame },
    consensusGame: { ...base.consensusGame },
    dilemmaGame: { ...base.dilemmaGame },
    triviaGame: { ...base.triviaGame },
    filRougeGame: { ...base.filRougeGame },
    guessLie: { ...emptyGuessLie(), sessionId: getState().lobbyCode || null },
    tierNightTopicId: null,
    tierNightGame: { ...base.tierNightGame },
  });
}

let activeScoringGameId = null;

/** Jeu actif pour le scoring (partie en cours). */
export function getActiveScoringGame() {
  return activeScoringGameId || state.gameScoreSessionGameId || null;
}

/** Définit le jeu auquel les points ajoutés via addScore() sont attribués. */
export function setActiveScoringGame(gameId) {
  activeScoringGameId = gameId || null;
}

/** Marque le début d'une partie : affichage in-game = points depuis ce snapshot. */
export function beginGameScoreSession(gameId) {
  if (!gameId) return;
  activeScoringGameId = gameId;
  state.gameScoreSessionGameId = gameId;
  state.gameScoreSessionBaseline = { ...(state.gameScores[gameId] || {}) };
  save();
}

/** Scores de la partie en cours (pas le cumul soirée). */
export function getCurrentSessionScoreMap(gameId = getActiveScoringGame()) {
  if (!gameId) return {};
  const total = state.gameScores[gameId] || {};
  const useBaseline = gameId === state.gameScoreSessionGameId;
  const base = useBaseline ? state.gameScoreSessionBaseline || {} : {};
  const names = new Set([
    ...Object.keys(total),
    ...Object.keys(base),
    ...Object.keys(state.scores),
  ]);
  const out = {};
  names.forEach((name) => {
    out[name] = (total[name] || 0) - (base[name] || 0);
  });
  return out;
}

function creditGameScore(playerName, points) {
  const gid = getActiveScoringGame();
  if (!gid) return;
  if (!state.gameScores[gid]) {
    state.gameScores[gid] = {};
    if (!state.gameScoreOrder.includes(gid)) {
      state.gameScoreOrder = [...state.gameScoreOrder, gid];
    }
  }
  state.gameScores[gid][playerName] = (state.gameScores[gid][playerName] || 0) + points;
}

export function addScore(playerName, points) {
  ensurePlayerScore(playerName);
  state.scores[playerName] += points;
  creditGameScore(playerName, points);
  save();
}

export function addFilRougeScore(playerName, points) {
  ensurePlayerScore(playerName);
  state.filRougeScores[playerName] = (state.filRougeScores[playerName] || 0) + points;
  save();
}

export function getFilRougeScores() {
  return state.filRougeScores || {};
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

/** Incrémente les stats de fin de partie une seule fois par gameId et par soirée. */
export function recordEveningGameOnce(gameId, apply) {
  if (!gameId || typeof apply !== "function") return false;
  if (!state.eveningGamesRecorded) state.eveningGamesRecorded = {};
  if (state.eveningGamesRecorded[gameId]) return false;
  state.eveningGamesRecorded[gameId] = true;
  apply();
  save();
  return true;
}

export function recordHotTakePlayed() {
  recordEveningGameOnce("hottake", () => {
    state.stats.hotTakesPlayed += 1;
    state.globalStats.hotTakesPlayed = (state.globalStats.hotTakesPlayed || 0) + 1;
  });
}

export function recordSpeedVotePlayed() {
  recordEveningGameOnce("speedvote", () => {
    state.stats.speedVotesPlayed = (state.stats.speedVotesPlayed || 0) + 1;
  });
}

export function recordPlaylistGuessPlayed() {
  recordEveningGameOnce("playlistguess", () => {
    state.stats.playlistGuessesPlayed = (state.stats.playlistGuessesPlayed || 0) + 1;
  });
}

export function recordTruthMeterPlayed() {
  recordEveningGameOnce("truthmeter", () => {
    state.stats.truthMetersPlayed = (state.stats.truthMetersPlayed || 0) + 1;
  });
}

export function recordConsensusPlayed() {
  recordEveningGameOnce("consensus", () => {
    state.stats.consensusGamesPlayed = (state.stats.consensusGamesPlayed || 0) + 1;
  });
}

export function recordDilemmaPlayed() {
  recordEveningGameOnce("dilemma", () => {
    state.stats.dilemmasPlayed = (state.stats.dilemmasPlayed || 0) + 1;
  });
}

export function recordTriviaPlayed() {
  recordEveningGameOnce("trivia", () => {
    state.stats.triviaGamesPlayed = (state.stats.triviaGamesPlayed || 0) + 1;
  });
}

export function recordTraitrePlayed() {
  recordEveningGameOnce("traitre", () => {
    state.stats.traitreGamesPlayed = (state.stats.traitreGamesPlayed || 0) + 1;
  });
}

export function recordTierNightPlayed() {
  recordEveningGameOnce("tiernight", () => {
    state.stats.tierNightsPlayed = (state.stats.tierNightsPlayed || 0) + 1;
  });
}

export function recordLieGuess(correct) {
  state.stats.liesTotal += 1;
  if (correct) {
    state.stats.liesFound += 1;
    state.globalStats.liesFound = (state.globalStats.liesFound || 0) + 1;
  }
  save();
}

/** Guess The Lie : une manche = un mensonge ; +1 trouvé si au moins un détective a raison. */
export function recordGuessLieRoundStats(lieDetected) {
  state.stats.liesTotal = (state.stats.liesTotal || 0) + 1;
  if (lieDetected) {
    state.stats.liesFound = (state.stats.liesFound || 0) + 1;
    state.globalStats.liesFound = (state.globalStats.liesFound || 0) + 1;
  }
  save();
}

export function getLieSuccessRate() {
  const { liesFound, liesTotal } = state.stats;
  if (liesTotal === 0) return "-";
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
  if (!state.lobbyCode) return;
  if (state.guessLie.sessionId !== state.lobbyCode) {
    state.guessLie.sessionId = state.lobbyCode;
    save();
  }
}

export async function setLocalGuessLieSubmission(statements, lieIndex) {
  syncGuessLieSession();
  const name = getLocalDisplayName();
  ensurePlayerScore(name);
  const payload = {
    statements: statements.map((s) => s.trim()),
    lie: lieIndex,
  };
  const { isGameSyncActive, commitGuessLieSubmission } = await import("./gameSync.js");
  if (isGameSyncActive()) {
    await commitGuessLieSubmission(name, payload);
  } else {
    state.guessLie.submissions[name] = payload;
    save();
  }
}

export function setGuessLieSubmission(playerName, payload) {
  syncGuessLieSession();
  ensurePlayerScore(playerName);
  state.guessLie.submissions[playerName] = payload;
  save();
}

function applyGuessLieLobbyCompleteLocal() {
  syncGuessLieSession();
  state.guessLie.lobbyComplete = true;
  state.guessLie.roundIdx = 0;
  state.guessLie.phase = "voting";
  state.guessLie.votes = {};
  state.guessLie.roundScored = false;
  save();
}

export async function markGuessLieLobbyComplete() {
  syncGuessLieSession();
  applyGuessLieLobbyCompleteLocal();
  const { launchGameWithSync } = await import("./mpLaunch.js");
  const { guessLieLobbyStartToRemote } = await import("./gameSync.js");
  return launchGameWithSync({
    screen: "guesslie",
    gameId: "guesslie",
    mode: "patch",
    applyLocal: applyGuessLieLobbyCompleteLocal,
    getRemoteState: () => ({ guessLie: guessLieLobbyStartToRemote() }),
  });
}

export function resetGuessLieSession() {
  syncGuessLieSession();
  state.guessLie = { ...emptyGuessLie(), sessionId: state.lobbyCode };
  save();
}

export function setTierNightTopicId(id) {
  state.tierNightTopicId = id;
  state.tierNightGame = { ...defaultState().tierNightGame };
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

export function deleteCustomTierList(id) {
  const lists = state.customTierLists || [];
  const next = lists.filter((t) => t.id !== id);
  if (next.length === lists.length) return false;
  state.customTierLists = next;
  if (state.tierNightTopicId === id) {
    state.tierNightTopicId = null;
  }
  save();
  return true;
}
