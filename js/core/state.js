import { flushSave, scheduleSave } from "./persist.js";
import { DEFAULT_PROFILE_EMOJI } from "../../data/profileEmojis.js";
import { trimPlayerText } from "../../data/playerTextLimits.js";

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
    clutchesPlayed: 0,
    wrongAnswersPlayed: 0,
    playlistGuessesPlayed: 0,
    truthMetersPlayed: 0,
    consensusGamesPlayed: 0,
    dilemmasPlayed: 0,
    triviaGamesPlayed: 0,
    traitreGamesPlayed: 0,
    guessLieGamesPlayed: 0,
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
  tierNightMode: "consensus",
  tierNightModifier: "normal",
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
    matchScores: {},
  },
  clutchGame: {
    ready: {},
    lobbyStarted: false,
    roundCount: 5,
    roundIdx: 0,
    phase: null,
    targetMs: null,
    hideBeforeMs: null,
    roundStartAt: null,
    roundEndsAt: null,
    taps: {},
    roundScored: false,
    matchScores: {},
    lastRound: null,
  },
  wrongAnswerGame: {
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
    tieAfterVote: false,
    voteSurvivals: 0,
    dealAcks: {},
    lastVoteSnapshot: null,
    lastEliminated: null,
    intuitionAwards: {},
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
  tierNightLiveGame: {
    lobbyStarted: false,
    topicId: null,
    listName: "",
    deck: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    placements: {},
    finished: false,
  },
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
      clutchGame: { ...defaultState().clutchGame, ...parsed.clutchGame },
      wrongAnswerGame: { ...defaultState().wrongAnswerGame, ...parsed.wrongAnswerGame },
      traitreGame: { ...defaultState().traitreGame, ...parsed.traitreGame },
      playlistGuessGame: { ...defaultState().playlistGuessGame, ...parsed.playlistGuessGame },
      truthMeterGame: { ...defaultState().truthMeterGame, ...parsed.truthMeterGame },
      consensusGame: { ...defaultState().consensusGame, ...parsed.consensusGame },
      dilemmaGame: { ...defaultState().dilemmaGame, ...parsed.dilemmaGame },
      triviaGame: { ...defaultState().triviaGame, ...parsed.triviaGame },
      filRougeGame: { ...defaultState().filRougeGame, ...parsed.filRougeGame },
      tierNightGame: { ...defaultState().tierNightGame, ...parsed.tierNightGame },
      tierNightLiveGame: { ...defaultState().tierNightLiveGame, ...parsed.tierNightLiveGame },
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

/**
 * Collision policies for rename key moves (Alice → Alicia):
 * - preferOld: keep the value under the name being renamed (authoritative local identity);
 *   discard leftover under the target key. Used for snapshots / atomic choices.
 * - preferNew: keep the value already under newKey (legacy alias of firstWins for taps if needed).
 * - max: Math.max for concurrent numeric views of the same counter (aligns with scoresFromRemote).
 * - or: boolean OR (ready / dealAcks).
 * - maxStats: per-numeric-field Math.max for playerStats (aligns with mergePlayerStatsRecord).
 *
 * Note: `sum` is intentionally unused — cumulative maps can hold concurrent full copies of the
 * same identity after a partial rename/sync; summing would double-count. Session deltas use
 * total − baseline, so baseline must use the same preferOld pairing as gameScores.
 */
function mergeKeyedRecord(record, oldKey, newKey, mode = "preferOld") {
  if (!record || oldKey === newKey || record[oldKey] === undefined) return record;
  const next = { ...record };
  const oldVal = next[oldKey];
  delete next[oldKey];
  if (next[newKey] === undefined) {
    next[newKey] = oldVal;
    return next;
  }
  const newVal = next[newKey];
  if (mode === "max") {
    next[newKey] = Math.max(Number(newVal) || 0, Number(oldVal) || 0);
  } else if (mode === "or") {
    next[newKey] = Boolean(newVal) || Boolean(oldVal);
  } else if (mode === "maxStats") {
    next[newKey] = mergePlayerStatsOnRename(oldVal, newVal);
  } else if (mode === "preferNew") {
    // keep newVal
  } else {
    // preferOld / firstWins-from-moving-identity
    next[newKey] = oldVal;
  }
  return next;
}

/** Per-counter max, same idea as playerStatsSync.mergePlayerStatsRecord. */
function mergePlayerStatsOnRename(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = {};
  keys.forEach((key) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (typeof av === "number" && typeof bv === "number") {
      out[key] = Math.max(av, bv);
    } else if (typeof bv === "number" && Number.isFinite(bv)) {
      out[key] = bv;
    } else if (typeof av === "number" && Number.isFinite(av)) {
      out[key] = av;
    }
  });
  return out;
}

/** Replace exact name values in a map (e.g. voter → target name). */
function rewriteNameValues(record, oldName, newName) {
  if (!record || typeof record !== "object") return record;
  let changed = false;
  const next = { ...record };
  for (const [key, value] of Object.entries(next)) {
    if (value === oldName) {
      next[key] = newName;
      changed = true;
    }
  }
  return changed ? next : record;
}

/**
 * Rename a map key then rewrite any values equal to the old pseudo.
 * Key move happens once; value rewrite once — no derived recount.
 * UUID keys are untouched because they never equal the display name string.
 */
function migrateNameKeyedMap(record, oldName, newName, mode = "preferOld") {
  if (!record || typeof record !== "object") return record;
  const keyed = mergeKeyedRecord(record, oldName, newName, mode);
  return rewriteNameValues(keyed, oldName, newName);
}

/** Rename names in an array; drop duplicates after replacement (order preserved). */
function migrateNameArray(arr, oldName, newName) {
  if (!Array.isArray(arr)) return arr;
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const next = item === oldName ? newName : item;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function migrateNameScalar(value, oldName, newName) {
  return value === oldName ? newName : value;
}

/** gameScores: { [gameId]: { [playerName]: number } } — preferOld pairs with baseline. */
function migrateNestedGameScores(gameScores, oldName, newName) {
  if (!gameScores || typeof gameScores !== "object") return gameScores;
  const next = { ...gameScores };
  for (const gameId of Object.keys(next)) {
    const inner = next[gameId];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      next[gameId] = mergeKeyedRecord(inner, oldName, newName, "preferOld");
    }
  }
  return next;
}

/**
 * Dedupe named entries after rename. `pickBetter(a, b)` returns the entry to keep
 * when both resolve to the same display name.
 */
function migrateNamedEntries(arr, oldName, newName, pickBetter) {
  if (!Array.isArray(arr)) return arr;
  const byName = new Map();
  const order = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") {
      order.push({ kind: "raw", value: entry });
      continue;
    }
    const next = entry.name === oldName ? { ...entry, name: newName } : { ...entry };
    const key = next.name;
    if (key == null) {
      order.push({ kind: "raw", value: next });
      continue;
    }
    if (!byName.has(key)) {
      byName.set(key, next);
      order.push({ kind: "named", key });
    } else {
      const kept = pickBetter ? pickBetter(byName.get(key), next) : byName.get(key);
      byName.set(key, kept);
    }
  }
  return order.map((slot) => (slot.kind === "raw" ? slot.value : byName.get(slot.key)));
}

/** Clutch ranking: keep best gap, then earliest tap (same order as rankClutchResults). */
function pickBetterClutchRanking(a, b) {
  const gapA = Number.isFinite(a.gap) ? a.gap : Infinity;
  const gapB = Number.isFinite(b.gap) ? b.gap : Infinity;
  if (gapA !== gapB) return gapA < gapB ? a : b;
  const atA = Number.isFinite(a.at) ? a.at : Infinity;
  const atB = Number.isFinite(b.at) ? b.at : Infinity;
  return atA <= atB ? a : b;
}

/** Trivia standings: keep higher score, then better (lower) rank. */
function pickBetterTriviaStanding(a, b) {
  const scoreA = Number(a.score) || 0;
  const scoreB = Number(b.score) || 0;
  if (scoreA !== scoreB) return scoreA > scoreB ? a : b;
  const rankA = Number.isFinite(a.rank) ? a.rank : Infinity;
  const rankB = Number.isFinite(b.rank) ? b.rank : Infinity;
  return rankA <= rankB ? a : b;
}

function migrateLastRoundNameMaps(lastRound, oldName, newName, opts = {}) {
  if (!lastRound || typeof lastRound !== "object") return lastRound;
  const next = { ...lastRound };
  // lastRound deltas/counts are concurrent snapshots of one round — not fragments to add.
  if (next.deltas) next.deltas = mergeKeyedRecord(next.deltas, oldName, newName, "preferOld");
  if (next.counts) next.counts = mergeKeyedRecord(next.counts, oldName, newName, "preferOld");
  if (next.answers) next.answers = mergeKeyedRecord(next.answers, oldName, newName, "preferOld");
  if (next.votes) next.votes = migrateNameKeyedMap(next.votes, oldName, newName, "preferOld");
  if (next.breakdown) {
    next.breakdown = mergeKeyedRecord(next.breakdown, oldName, newName, "preferOld");
  }
  if (Array.isArray(next.ranking)) {
    next.ranking = migrateNamedEntries(next.ranking, oldName, newName, pickBetterClutchRanking);
  }
  const arrayFields = opts.nameArrays || [];
  for (const field of arrayFields) {
    if (Array.isArray(next[field])) {
      next[field] = migrateNameArray(next[field], oldName, newName);
    }
  }
  const scalarFields = opts.nameScalars || [];
  for (const field of scalarFields) {
    next[field] = migrateNameScalar(next[field], oldName, newName);
  }
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

  // Cumulative evening totals: preferOld keeps the renaming identity's ledger (avoids
  // double-count from orphan copies under the target name). Paired with baseline below.
  state.scores = mergeKeyedRecord(state.scores, oldName, trimmed, "preferOld");
  state.filRougeScores = mergeKeyedRecord(state.filRougeScores, oldName, trimmed, "preferOld");
  state.playerStats = mergeKeyedRecord(state.playerStats, oldName, trimmed, "maxStats");
  state.gameScores = migrateNestedGameScores(state.gameScores, oldName, trimmed);
  // Snapshot for getCurrentSessionScoreMap: (gameScores[gid][n] − baseline[n]).
  // Must preferOld like gameScores so a collision cannot invent a wrong in-game delta.
  state.gameScoreSessionBaseline = mergeKeyedRecord(
    state.gameScoreSessionBaseline,
    oldName,
    trimmed,
    "preferOld"
  );

  if (state.guessLie) {
    if (state.guessLie.submissions) {
      // Atomic { statements, lie } — never field-merge two submissions.
      state.guessLie.submissions = mergeKeyedRecord(
        state.guessLie.submissions,
        oldName,
        trimmed,
        "preferOld"
      );
    }
    if (state.guessLie.votes) {
      state.guessLie.votes = mergeKeyedRecord(state.guessLie.votes, oldName, trimmed, "preferOld");
    }
  }

  const ht = state.hotTakeGame;
  if (ht) {
    if (ht.ready) ht.ready = mergeKeyedRecord(ht.ready, oldName, trimmed, "or");
    if (ht.votes) ht.votes = mergeKeyedRecord(ht.votes, oldName, trimmed, "preferOld");
    if (ht.matchScores) {
      ht.matchScores = mergeKeyedRecord(ht.matchScores, oldName, trimmed, "preferOld");
    }
    ht.pausedBy = migrateNameScalar(ht.pausedBy, oldName, trimmed);
    if (Array.isArray(ht.customTakes)) {
      ht.customTakes = ht.customTakes.map((t) =>
        t?.author === oldName ? { ...t, author: trimmed } : t
      );
    }
    if (ht.lastRound) {
      ht.lastRound = migrateLastRoundNameMaps(ht.lastRound, oldName, trimmed, {
        nameArrays: ["dissenters", "majorityWinners", "tieWinners"],
      });
    }
  }

  const dm = state.dilemmaGame;
  if (dm) {
    if (dm.ready) dm.ready = mergeKeyedRecord(dm.ready, oldName, trimmed, "or");
    if (dm.votes) dm.votes = mergeKeyedRecord(dm.votes, oldName, trimmed, "preferOld");
    if (dm.matchScores) {
      dm.matchScores = mergeKeyedRecord(dm.matchScores, oldName, trimmed, "preferOld");
    }
    dm.pausedBy = migrateNameScalar(dm.pausedBy, oldName, trimmed);
    if (Array.isArray(dm.customDilemmas)) {
      dm.customDilemmas = dm.customDilemmas.map((d) =>
        d?.author === oldName ? { ...d, author: trimmed } : d
      );
    }
    if (dm.lastRound) {
      dm.lastRound = migrateLastRoundNameMaps(dm.lastRound, oldName, trimmed, {
        nameArrays: ["majorityWinners", "tieWinners"],
      });
    }
  }

  const consensus = state.consensusGame;
  if (consensus) {
    if (consensus.ready) consensus.ready = mergeKeyedRecord(consensus.ready, oldName, trimmed, "or");
    if (consensus.answers) {
      consensus.answers = mergeKeyedRecord(consensus.answers, oldName, trimmed, "preferOld");
    }
    if (consensus.matchScores) {
      consensus.matchScores = mergeKeyedRecord(consensus.matchScores, oldName, trimmed, "preferOld");
    }
    if (consensus.lastRound) {
      consensus.lastRound = migrateLastRoundNameMaps(consensus.lastRound, oldName, trimmed, {
        nameArrays: [
          "precisionPlayers",
          "closestPlayers",
          "intuitionPlayers",
          "consensusPlayers",
        ],
      });
    }
  }

  const sv = state.speedVoteGame;
  if (sv) {
    if (sv.ready) sv.ready = mergeKeyedRecord(sv.ready, oldName, trimmed, "or");
    // Votes: voter → target player name (key once, target value once).
    if (sv.votes) sv.votes = migrateNameKeyedMap(sv.votes, oldName, trimmed, "preferOld");
    if (sv.matchScores) {
      sv.matchScores = mergeKeyedRecord(sv.matchScores, oldName, trimmed, "preferOld");
    }
  }

  const clutch = state.clutchGame;
  if (clutch) {
    if (clutch.ready) clutch.ready = mergeKeyedRecord(clutch.ready, oldName, trimmed, "or");
    // Renaming identity's tap wins over orphan under the target name.
    if (clutch.taps) clutch.taps = mergeKeyedRecord(clutch.taps, oldName, trimmed, "preferOld");
    if (clutch.matchScores) {
      clutch.matchScores = mergeKeyedRecord(clutch.matchScores, oldName, trimmed, "preferOld");
    }
    if (clutch.lastRound) {
      clutch.lastRound = migrateLastRoundNameMaps(clutch.lastRound, oldName, trimmed);
    }
  }

  const wa = state.wrongAnswerGame;
  if (wa) {
    if (wa.ready) wa.ready = mergeKeyedRecord(wa.ready, oldName, trimmed, "or");
    if (wa.answers) wa.answers = mergeKeyedRecord(wa.answers, oldName, trimmed, "preferOld");
    if (wa.votes) wa.votes = migrateNameKeyedMap(wa.votes, oldName, trimmed, "preferOld");
    if (wa.matchScores) {
      wa.matchScores = mergeKeyedRecord(wa.matchScores, oldName, trimmed, "preferOld");
    }
    if (wa.lastRound) {
      wa.lastRound = migrateLastRoundNameMaps(wa.lastRound, oldName, trimmed);
    }
  }

  const traitre = state.traitreGame;
  if (traitre) {
    if (traitre.ready) traitre.ready = mergeKeyedRecord(traitre.ready, oldName, trimmed, "or");
    if (traitre.dealAcks) {
      traitre.dealAcks = mergeKeyedRecord(traitre.dealAcks, oldName, trimmed, "or");
    }
    if (traitre.intuitionAwards) {
      traitre.intuitionAwards = mergeKeyedRecord(
        traitre.intuitionAwards,
        oldName,
        trimmed,
        "preferOld"
      );
    }
    if (traitre.votes) {
      traitre.votes = migrateNameKeyedMap(traitre.votes, oldName, trimmed, "preferOld");
    }
    if (traitre.lastVoteSnapshot) {
      traitre.lastVoteSnapshot = migrateNameKeyedMap(
        traitre.lastVoteSnapshot,
        oldName,
        trimmed,
        "preferOld"
      );
    }
    traitre.impostorName = migrateNameScalar(traitre.impostorName, oldName, trimmed);
    traitre.lastEliminated = migrateNameScalar(traitre.lastEliminated, oldName, trimmed);
    if (Array.isArray(traitre.alive)) {
      traitre.alive = migrateNameArray(traitre.alive, oldName, trimmed);
    }
    if (Array.isArray(traitre.eliminated)) {
      traitre.eliminated = migrateNameArray(traitre.eliminated, oldName, trimmed);
    }
    if (traitre.lastRound) {
      traitre.lastRound = migrateLastRoundNameMaps(traitre.lastRound, oldName, trimmed, {
        nameScalars: ["impostorName"],
      });
    }
  }

  const pg = state.playlistGuessGame;
  if (pg) {
    // Solo keys may equal display names; MP keys are UUIDs and never match oldName.
    if (pg.ready) pg.ready = mergeKeyedRecord(pg.ready, oldName, trimmed, "or");
    if (pg.votes) pg.votes = migrateNameKeyedMap(pg.votes, oldName, trimmed, "preferOld");
    if (Array.isArray(pg.participantNames)) {
      pg.participantNames = migrateNameArray(pg.participantNames, oldName, trimmed);
    }
  }

  const tm = state.truthMeterGame;
  if (tm) {
    if (tm.ready) tm.ready = mergeKeyedRecord(tm.ready, oldName, trimmed, "or");
    if (tm.votes) tm.votes = mergeKeyedRecord(tm.votes, oldName, trimmed, "preferOld");
    if (tm.matchScores) {
      tm.matchScores = mergeKeyedRecord(tm.matchScores, oldName, trimmed, "preferOld");
    }
    if (Array.isArray(tm.authorOrder)) {
      tm.authorOrder = migrateNameArray(tm.authorOrder, oldName, trimmed);
    }
    if (tm.affirmation && typeof tm.affirmation === "object") {
      tm.affirmation = {
        ...tm.affirmation,
        author: migrateNameScalar(tm.affirmation.author, oldName, trimmed),
      };
    }
    if (tm.lastRound) {
      tm.lastRound = migrateLastRoundNameMaps(tm.lastRound, oldName, trimmed, {
        nameScalars: ["mindReader"],
      });
    }
  }

  const trivia = state.triviaGame;
  if (trivia) {
    if (trivia.ready) trivia.ready = mergeKeyedRecord(trivia.ready, oldName, trimmed, "or");
    if (trivia.answers) {
      trivia.answers = mergeKeyedRecord(trivia.answers, oldName, trimmed, "preferOld");
    }
    if (trivia.matchScores) {
      trivia.matchScores = mergeKeyedRecord(trivia.matchScores, oldName, trimmed, "preferOld");
    }
    if (trivia.lastRound) {
      trivia.lastRound = migrateLastRoundNameMaps(trivia.lastRound, oldName, trimmed, {
        nameArrays: ["correctPlayers"],
        nameScalars: ["fastestPlayer"],
      });
    }
    if (Array.isArray(trivia.results?.standings)) {
      trivia.results = {
        ...trivia.results,
        standings: migrateNamedEntries(
          trivia.results.standings,
          oldName,
          trimmed,
          pickBetterTriviaStanding
        ),
      };
    }
  }

  const tnl = state.tierNightLiveGame;
  if (tnl) {
    if (tnl.votes) tnl.votes = mergeKeyedRecord(tnl.votes, oldName, trimmed, "preferOld");
    if (tnl.placements) {
      tnl.placements = mergeKeyedRecord(tnl.placements, oldName, trimmed, "preferOld");
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
        p.isLocal ? { ...p, name: trimmed } : p
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
  activeScoringGameId = null;
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
    clutchesPlayed: 0,
    wrongAnswersPlayed: 0,
    playlistGuessesPlayed: 0,
    truthMetersPlayed: 0,
    consensusGamesPlayed: 0,
    dilemmasPlayed: 0,
    triviaGamesPlayed: 0,
    traitreGamesPlayed: 0,
    guessLieGamesPlayed: 0,
  };
}

/** Au moins une partie ou des points enregistrés cette soirée (local). */
export function normalizeEveningGamesRecorded(recorded = {}) {
  const out = {};
  Object.entries(recorded || {}).forEach(([gameId, value]) => {
    if (gameId && value) out[gameId] = true;
  });
  return out;
}

export function mergeEveningGamesRecorded(local = {}, remote = {}) {
  return {
    ...normalizeEveningGamesRecorded(local),
    ...normalizeEveningGamesRecorded(remote),
  };
}

export function hasEveningStatsActivity() {
  const { stats, scores, eveningGamesRecorded } = getState();
  if (eveningGamesRecorded && Object.keys(eveningGamesRecorded).length > 0) return true;
  if (Object.values(scores || {}).some((n) => Number(n) > 0)) return true;
  const s = stats || {};
  return (
    (s.hotTakesPlayed || 0) > 0 ||
    (s.speedVotesPlayed || 0) > 0 ||
    (s.clutchesPlayed || 0) > 0 ||
    (s.wrongAnswersPlayed || 0) > 0 ||
    (s.playlistGuessesPlayed || 0) > 0 ||
    (s.traitreGamesPlayed || 0) > 0 ||
    (s.triviaGamesPlayed || 0) > 0 ||
    (s.truthMetersPlayed || 0) > 0 ||
    (s.consensusGamesPlayed || 0) > 0 ||
    (s.dilemmasPlayed || 0) > 0 ||
    (s.liesTotal || 0) > 0 ||
    (s.tierNightsPlayed || 0) > 0 ||
    (s.guessLieGamesPlayed || 0) > 0
  );
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
    clutchGame: { ...base.clutchGame },
    wrongAnswerGame: { ...base.wrongAnswerGame },
    traitreGame: { ...base.traitreGame },
    playlistGuessGame: { ...base.playlistGuessGame },
    truthMeterGame: { ...base.truthMeterGame },
    consensusGame: { ...base.consensusGame },
    dilemmaGame: { ...base.dilemmaGame },
    triviaGame: { ...base.triviaGame },
    filRougeGame: { ...base.filRougeGame },
    guessLie: { ...emptyGuessLie(), sessionId: getState().lobbyCode || null },
    tierNightTopicId: null,
    tierNightMode: "consensus",
    tierNightModifier: "normal",
    tierNightGame: { ...base.tierNightGame },
    tierNightLiveGame: { ...base.tierNightLiveGame },
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
  ensureGameScoreEntry(gid);
  state.gameScores[gid][playerName] = (state.gameScores[gid][playerName] || 0) + points;
}

function ensureGameScoreEntry(gameId) {
  if (!gameId) return;
  if (!state.gameScores[gameId]) state.gameScores[gameId] = {};
  if (!state.gameScoreOrder.includes(gameId)) {
    state.gameScoreOrder = [...state.gameScoreOrder, gameId];
  }
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

/** Garde la fin de partie la plus récente (évite qu'un ancien lastGame écrase le dernier jeu). */
export function mergeLastGameRecord(local, remote) {
  if (!remote) return local ?? null;
  if (!local) return remote;
  const localAt = Number(local.at) || 0;
  const remoteAt = Number(remote.at) || 0;
  return remoteAt >= localAt ? remote : local;
}

/** Incrémente les stats de fin de partie une seule fois par gameId et par soirée. */
export function recordEveningGameOnce(gameId, apply) {
  if (!gameId || typeof apply !== "function") return false;
  if (!state.eveningGamesRecorded) state.eveningGamesRecorded = {};
  ensureGameScoreEntry(gameId);
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

export function recordClutchPlayed() {
  recordEveningGameOnce("clutch", () => {
    state.stats.clutchesPlayed = (state.stats.clutchesPlayed || 0) + 1;
  });
}

export function recordWrongAnswerPlayed() {
  recordEveningGameOnce("wronganswer", () => {
    state.stats.wrongAnswersPlayed = (state.stats.wrongAnswersPlayed || 0) + 1;
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

export function recordGuessLiePlayed() {
  recordEveningGameOnce("guesslie", () => {
    state.stats.guessLieGamesPlayed = (state.stats.guessLieGamesPlayed || 0) + 1;
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
    statements: statements.map((s) => trimPlayerText(s)),
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

export function applyGuessLieLobbyCompleteLocal() {
  syncGuessLieSession();
  state.guessLie.lobbyComplete = true;
  state.guessLie.roundIdx = 0;
  state.guessLie.phase = "voting";
  state.guessLie.votes = {};
  state.guessLie.roundScored = false;
  save();
  flushSave();
}

/** Sync MP attendable (lobby playing + patch game_sessions). */
export async function syncGuessLieLobbyCompleteRemote() {
  const { isGameSyncActive, isLobbyHost, guessLieLobbyStartToRemote } = await import(
    "./gameSync.js"
  );
  if (!isGameSyncActive() || !isLobbyHost()) return { ok: true, skipped: true };

  const { commitMultiplayerLaunch } = await import("./mpLaunch.js");
  const { setLobbyPlaying } = await import("./lobby.js");
  const remotePayload = { guessLie: guessLieLobbyStartToRemote() };

  try {
    await setLobbyPlaying("guesslie");
    await commitMultiplayerLaunch({
      screen: "guesslie",
      gameId: "guesslie",
      state: remotePayload,
      mode: "patch",
    });
    return { ok: true };
  } catch (err) {
    console.warn("Guess The Lie sync:", err);
    void commitMultiplayerLaunch({
      screen: "guesslie",
      gameId: "guesslie",
      state: remotePayload,
      mode: "patch",
    }).catch(() => {});
    return { ok: false, usedFallback: true, error: err };
  }
}

export async function markGuessLieLobbyComplete() {
  applyGuessLieLobbyCompleteLocal();
  return syncGuessLieLobbyCompleteRemote();
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

export function setTierNightMode(mode) {
  state.tierNightMode = mode || "consensus";
  save();
}

export function getTierNightMode() {
  return state.tierNightMode || "consensus";
}

export function setTierNightModifier(modifier) {
  state.tierNightModifier = modifier || "normal";
  save();
}

export function getTierNightModifier() {
  return state.tierNightModifier || "normal";
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
