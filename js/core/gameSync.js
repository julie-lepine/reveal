import { isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import {
  getLocalDisplayName,
  getState,
  saveStatePatch,
  recordTierNightPlayed,
  resetEveningState,
} from "./state.js";
import { navigate, getCurrentScreen } from "./router.js";
import { getLobbyParticipants } from "./lobby.js";
import { buildRecapsFromPlacements, getTierNightSession } from "./tierNightSession.js";
import {
  fetchGameSessionByLobby,
  upsertGameSession,
  updateGameSession,
  deleteGameSession,
} from "./supabaseGame.js";

let cachedRow = null;
let lastSessionSig = "";
const listeners = new Set();
let routing = false;
let pollTimer = null;
/** Évite de forcer l’écran de prep quand l’invité revient au menu manuellement. */
let suppressSessionRouteUntil = 0;
/** Écran de session ignoré pendant la suppression (retour invité au menu jeux). */
let suppressSessionScreen = null;

const MENU_SCREENS = new Set(["home", "lobby", "game-select", "settings"]);
export const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);

/** L'invité sur le menu jeux / lobby doit suivre l'hôte qui lance une partie (malgré suppress). */
function shouldFollowHostGameLaunch(current, targetScreen) {
  if (!targetScreen || !isActiveGameSessionScreen(targetScreen)) return false;
  if (current === "home" || current === "settings") return false;
  return current === "game-select" || current === "lobby";
}

function sessionSignature(row) {
  if (!row) return "";
  return `${row.screen}|${JSON.stringify(row.state || {})}`;
}

export function isGameSyncActive() {
  return isSupabaseConfigured() && Boolean(getState().lobby?.id);
}

export function isLobbyHost() {
  const local = getState().lobby?.participants?.find((p) => p.isLocal);
  return Boolean(local?.isHost);
}

/** Écrans de préparation (jeu choisi mais pas encore lancé). */
const GAME_SETUP_SCREENS = new Set([
  "hottake-prep",
  "speedvote-prep",
  "truthmeter-prep",
  "dilemma-prep",
  "guesslie-menu",
  "guesslie-setup",
  "guesslie-wait",
  "tiernight-select",
  "tiernight-create",
]);

/** Guess The Lie : préparation par joueur — la session reste sur guesslie-menu. */
const GUESS_LIE_PREP_SCREENS = new Set(["guesslie-menu", "guesslie-setup", "guesslie-wait"]);

/** Tier Night : création locale possible depuis tiernight-select. */
const TIER_NIGHT_PREP_SCREENS = new Set(["tiernight-select", "tiernight-create"]);

export function isCompatibleSessionScreen(sessionScreen, localScreen) {
  if (sessionScreen === localScreen) return true;
  if (sessionScreen === "guesslie-menu" && GUESS_LIE_PREP_SCREENS.has(localScreen)) return true;
  if (sessionScreen === "tiernight-select" && TIER_NIGHT_PREP_SCREENS.has(localScreen)) return true;
  /** Résultats ↔ classement : navigation locale sans forcer le retour via la session. */
  if (
    (sessionScreen === "results" && localScreen === "leaderboard") ||
    (sessionScreen === "leaderboard" && localScreen === "results")
  ) {
    return true;
  }
  /** Consulter le classement depuis le menu jeux / lobby sans être renvoyé. */
  if (
    localScreen === "leaderboard" &&
    (sessionScreen === "game-select" || sessionScreen === "lobby")
  ) {
    return true;
  }
  /** Retour lobby volontaire depuis le menu jeux (suppress actif). */
  if (
    sessionScreen === "game-select" &&
    localScreen === "lobby" &&
    Date.now() < suppressSessionRouteUntil
  ) {
    return true;
  }
  if (
    sessionScreen === "game-select" &&
    (localScreen === "filrouge-setup" || localScreen === "filrouge-mission")
  ) {
    return true;
  }
  /** Accueil / paramètres : libre si pas de partie en cours ; sinon rattrapage vers le jeu. */
  if (getState().inLobby && getState().lobby?.id) {
    if (localScreen === "settings" || localScreen === "home") {
      if (isActiveGameSessionScreen(sessionScreen)) return false;
      return true;
    }
  }
  return false;
}

export function isOnGameSetupScreen(screen = getCurrentScreen()) {
  return GAME_SETUP_SCREENS.has(screen);
}

export function getCachedGameSession() {
  return cachedRow;
}

export function onGameSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(row) {
  listeners.forEach((fn) => {
    try {
      fn(row);
    } catch (e) {
      console.warn("gameSync listener:", e);
    }
  });
}

export function userIdForName(name) {
  const p = getState().lobby?.participants?.find((x) => x.name === name);
  return p?.userId || null;
}

export function nameForUserId(uid) {
  const p = getState().lobby?.participants?.find((x) => x.userId === uid);
  return p?.name || null;
}

function mapReadyByName(readyByUid = {}) {
  const out = {};
  Object.entries(readyByUid).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    out[name] = Boolean(val);
  });
  return out;
}

function mapReadyByUid(readyByName = {}) {
  const out = {};
  Object.entries(readyByName).forEach(([name, val]) => {
    const uid = userIdForName(name) || name;
    out[uid] = Boolean(val);
  });
  return out;
}

function mapVotesByName(votesByUid = {}) {
  const out = {};
  Object.entries(votesByUid).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    if (val != null) out[name] = val;
  });
  return out;
}

function mapVotesByUid(votesByName = {}) {
  const out = {};
  Object.entries(votesByName).forEach(([name, val]) => {
    const uid = userIdForName(name) || name;
    if (val != null) out[uid] = val;
  });
  return out;
}

function mapSubmissionsByName(subsByUid = {}) {
  const out = {};
  Object.entries(subsByUid).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    if (val) out[name] = val;
  });
  return out;
}

function mapSubmissionsByUid(subsByName = {}) {
  const out = {};
  Object.entries(subsByName).forEach(([name, val]) => {
    const uid = userIdForName(name) || name;
    if (val) out[uid] = val;
  });
  return out;
}

function mapPlacementsByName(placementsByUid = {}) {
  const out = {};
  Object.entries(placementsByUid).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    if (val) out[name] = val;
  });
  return out;
}

function mapPlacementsByUid(placementsByName = {}) {
  const out = {};
  Object.entries(placementsByName).forEach(([name, val]) => {
    const uid = userIdForName(name) || name;
    if (val) out[uid] = val;
  });
  return out;
}

export function hotTakeToRemote(session) {
  return {
    customTakes: session.customTakes || [],
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    pausedBy: session.pausedBy ? userIdForName(session.pausedBy) || session.pausedBy : null,
    selectedThemeId: session.selectedThemeId || "catalog",
    roundCount: session.roundCount ?? 5,
    deck: session.deck || null,
    takeIdx: session.takeIdx ?? 0,
    phase: session.phase || null,
    votes: mapVotesByUid(session.votes || {}),
    voteEndsAt: session.voteEndsAt || null,
    voteTimerRemaining:
      session.voteTimerRemaining != null ? session.voteTimerRemaining : null,
    intermissionEndsAt: session.intermissionEndsAt || null,
    takeScored: Boolean(session.takeScored),
  };
}

export function hotTakeFromRemote(remote) {
  if (!remote) return null;
  return {
    customTakes: remote.customTakes || [],
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    pausedBy: remote.pausedBy ? nameForUserId(remote.pausedBy) || remote.pausedBy : null,
    selectedThemeId: remote.selectedThemeId || "catalog",
    roundCount: remote.roundCount ?? 5,
    deck: remote.deck || null,
    takeIdx: remote.takeIdx ?? 0,
    phase: remote.phase || null,
    votes: mapVotesByName(remote.votes || {}),
    voteEndsAt: remote.voteEndsAt || null,
    voteTimerRemaining:
      remote.voteTimerRemaining != null ? remote.voteTimerRemaining : null,
    intermissionEndsAt: remote.intermissionEndsAt || null,
    takeScored: Boolean(remote.takeScored),
  };
}

/** Nouvelle manche de vote (chrono relancé, votes vidés côté hôte). */
function isNewHotTakeVoteRound(cur, inc) {
  return (
    inc?.phase === "voting" &&
    inc?.voteEndsAt &&
    inc.voteEndsAt !== cur?.voteEndsAt &&
    Object.keys(inc.votes || {}).length === 0
  );
}

/** Fusion des votes uid (écriture patch) — évite d’écraser les votes des autres joueurs. */
function mergeRemoteHotTakeVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewHotTakeVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

/** Fusion des « prêt » uid (écriture patch). */
function mergeRemoteReadyUid(cur, inc) {
  return { ...(cur?.ready || {}), ...(inc?.ready || {}) };
}

/** En préparation : conserve le « prêt » local si pas encore sur le serveur. */
function mergeReadyMapsLocal(localReady = {}, remoteReady = {}) {
  const merged = { ...remoteReady };
  const name = getLocalDisplayName();
  if (localReady[name] && !merged[name]) merged[name] = true;
  return merged;
}

/** Fusion locale à l’application d’une session distante. */
function mergeHotTakeGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (isNewHotTakeVoteRound(local, remote)) {
    votes = remoteVotes;
  } else if (remote.phase === "voting") {
    votes = { ...remoteVotes };
    const name = getLocalDisplayName();
    const lv = localVotes[name];
    if (lv != null) votes[name] = lv;
  } else if (remote.phase === "reveal" || local.phase === "reveal") {
    votes = { ...remoteVotes, ...localVotes };
  }
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {})
      : remote.ready || {};
  return { ...local, ...remote, votes, ready };
}

function isNewSpeedVoteVoteRound(cur, inc) {
  return (
    inc?.phase === "voting" &&
    inc?.voteEndsAt &&
    inc.voteEndsAt !== cur?.voteEndsAt &&
    Object.keys(inc.votes || {}).length === 0
  );
}

function mergeRemoteSpeedVoteVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewSpeedVoteVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

function mergeSpeedVoteGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (isNewSpeedVoteVoteRound(local, remote)) {
    votes = remoteVotes;
  } else if (remote.phase === "voting") {
    votes = { ...remoteVotes };
    const name = getLocalDisplayName();
    if (localVotes[name] != null) votes[name] = localVotes[name];
  } else if (remote.phase === "reveal" || local.phase === "reveal") {
    votes = { ...remoteVotes, ...localVotes };
  }
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {})
      : remote.ready || {};
  return { ...local, ...remote, votes, ready };
}

function isNewDilemmaVoteRound(cur, inc) {
  return (
    inc?.phase === "voting" &&
    inc?.voteEndsAt &&
    inc.voteEndsAt !== cur?.voteEndsAt &&
    Object.keys(inc.votes || {}).length === 0
  );
}

function mergeRemoteDilemmaVotes(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewDilemmaVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

function mergeRemoteDilemmaReactions(cur, inc) {
  const curReactions = cur?.reactions || {};
  const incReactions = inc?.reactions || {};
  if (isNewDilemmaVoteRound(cur, inc)) return incReactions;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curReactions, ...incReactions };
  }
  return incReactions;
}

function mergeDilemmaGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {})
      : remote.ready || {};
  const votes = mergeRemoteDilemmaVotes(local, remote);
  const reactions = mergeRemoteDilemmaReactions(local, remote);
  return { ...local, ...remote, ready, votes, reactions };
}

function isNewTruthMeterVoteRound(cur, inc) {
  return (
    inc?.phase === "voting" &&
    inc?.voteEndsAt &&
    inc.voteEndsAt !== cur?.voteEndsAt &&
    Object.keys(inc.votes || {}).length === 0
  );
}

function mergeRemoteTruthMeterVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewTruthMeterVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    inc?.phase === "reveal-pending" ||
    cur?.phase === "reveal" ||
    cur?.phase === "reveal-pending"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

function mergeTruthMeterGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (isNewTruthMeterVoteRound(local, remote)) {
    votes = remoteVotes;
  } else if (remote.phase === "voting") {
    votes = { ...remoteVotes };
    const name = getLocalDisplayName();
    const lv = localVotes[name];
    if (lv != null && votes[name] == null) votes[name] = lv;
  } else if (remote.phase === "reveal" || remote.phase === "reveal-pending") {
    votes = { ...remoteVotes };
  } else if (local.phase === "reveal" || local.phase === "reveal-pending") {
    votes = { ...localVotes, ...remoteVotes };
  }
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {})
      : remote.ready || {};
  return { ...local, ...remote, votes, ready };
}

export function truthMeterToRemote(session) {
  return {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    authorOrder: session.authorOrder || [],
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    affirmation: session.affirmation || null,
    authorEstimate:
      session.authorEstimate != null && Number.isFinite(session.authorEstimate)
        ? session.authorEstimate
        : null,
    votes: mapVotesByUid(session.votes || {}),
    voteEndsAt: session.voteEndsAt || null,
    roundScored: Boolean(session.roundScored),
  };
}

export function truthMeterFromRemote(remote) {
  if (!remote) return null;
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    authorOrder: remote.authorOrder || [],
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    affirmation: remote.affirmation || null,
    authorEstimate:
      remote.authorEstimate != null && Number.isFinite(remote.authorEstimate)
        ? remote.authorEstimate
        : null,
    votes: mapVotesByName(remote.votes || {}),
    voteEndsAt: remote.voteEndsAt || null,
    roundScored: Boolean(remote.roundScored),
  };
}

export function speedVoteToRemote(session) {
  const remoteVotes = {};
  Object.entries(session.votes || {}).forEach(([voter, target]) => {
    remoteVotes[userIdForName(voter) || voter] = userIdForName(target) || target;
  });
  return {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    selectedThemeId: session.selectedThemeId || "catalog",
    roundCount: session.roundCount ?? 5,
    deck: session.deck || null,
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    currentQuestion: session.currentQuestion || null,
    votes: remoteVotes,
    voteEndsAt: session.voteEndsAt || null,
    roundScored: Boolean(session.roundScored),
    modifier: session.modifier || "normal",
  };
}

export function dilemmaToRemote(session) {
  const remoteVotes = {};
  Object.entries(session.votes || {}).forEach(([voter, choice]) => {
    remoteVotes[userIdForName(voter) || voter] = choice;
  });
  const remoteReactions = {};
  Object.entries(session.reactions || {}).forEach(([voter, reaction]) => {
    remoteReactions[userIdForName(voter) || voter] = reaction;
  });
  return {
    customDilemmas: session.customDilemmas || [],
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    selectedDeckId: session.selectedDeckId || "catalog",
    roundCount: session.roundCount ?? 8,
    deck: session.deck || null,
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    currentDilemma: session.currentDilemma || null,
    votes: remoteVotes,
    reactions: remoteReactions,
    voteEndsAt: session.voteEndsAt || null,
    roundScored: Boolean(session.roundScored),
    blindMode: Boolean(session.blindMode),
    pausedBy: session.pausedBy ? userIdForName(session.pausedBy) || session.pausedBy : null,
  };
}

export function dilemmaFromRemote(remote) {
  if (!remote) return null;
  const votes = {};
  Object.entries(remote.votes || {}).forEach(([voterUid, choice]) => {
    const voter = nameForUserId(voterUid) || voterUid;
    votes[voter] = choice;
  });
  const reactions = {};
  Object.entries(remote.reactions || {}).forEach(([voterUid, reaction]) => {
    const voter = nameForUserId(voterUid) || voterUid;
    reactions[voter] = reaction;
  });
  return {
    customDilemmas: remote.customDilemmas || [],
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    selectedDeckId: remote.selectedDeckId || "catalog",
    roundCount: remote.roundCount ?? 8,
    deck: remote.deck || null,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    currentDilemma: remote.currentDilemma || null,
    votes,
    reactions,
    voteEndsAt: remote.voteEndsAt || null,
    roundScored: Boolean(remote.roundScored),
    blindMode: Boolean(remote.blindMode),
    pausedBy: remote.pausedBy ? nameForUserId(remote.pausedBy) || remote.pausedBy : null,
  };
}

function mapFilRougeValidationsToUid(validations = {}) {
  const out = {};
  Object.entries(validations).forEach(([key, val]) => {
    const uid = userIdForName(key) || key;
    out[uid] = val;
  });
  return out;
}

export function filRougeToRemote(session) {
  const submissions = {};
  Object.entries(session.submissions || {}).forEach(([k, v]) => {
    submissions[userIdForName(k) || k] = v;
  });
  const missionAcks = {};
  Object.entries(session.missionAcks || {}).forEach(([k, v]) => {
    missionAcks[userIdForName(k) || k] = v;
  });
  return {
    status: session.status || "idle",
    submissions,
    missionAcks,
    validations: mapFilRougeValidationsToUid(session.validations || {}),
    resultsModalOpen: Boolean(session.resultsModalOpen),
    resultsSnapshot: session.resultsSnapshot || null,
    closedAt: session.closedAt || null,
    closedByUid: session.closedByUid
      ? userIdForName(session.closedByUid) || session.closedByUid
      : null,
  };
}

export function filRougeFromRemote(remote) {
  if (!remote) return null;
  return {
    status: remote.status || "idle",
    submissions: { ...(remote.submissions || {}) },
    missionAcks: { ...(remote.missionAcks || {}) },
    validations: { ...(remote.validations || {}) },
    resultsModalOpen: Boolean(remote.resultsModalOpen),
    resultsSnapshot: remote.resultsSnapshot || null,
    closedAt: remote.closedAt || null,
    closedByUid: remote.closedByUid || null,
  };
}

function mergeFilRougeRemote(cur, inc) {
  if (!inc) return cur;
  if (!cur) return inc;
  return {
    ...cur,
    ...inc,
    submissions: { ...(cur.submissions || {}), ...(inc.submissions || {}) },
    missionAcks: { ...(cur.missionAcks || {}), ...(inc.missionAcks || {}) },
    validations: { ...(cur.validations || {}), ...(inc.validations || {}) },
    resultsSnapshot: inc.resultsSnapshot ?? cur.resultsSnapshot,
  };
}

function mergeFilRougeLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  return mergeFilRougeRemote(local, remote);
}

export function speedVoteFromRemote(remote) {
  if (!remote) return null;
  const votes = {};
  Object.entries(remote.votes || {}).forEach(([voterUid, targetUid]) => {
    const voter = nameForUserId(voterUid) || voterUid;
    const target = nameForUserId(targetUid) || targetUid;
    votes[voter] = target;
  });
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    selectedThemeId: remote.selectedThemeId || "catalog",
    roundCount: remote.roundCount ?? 5,
    deck: remote.deck || null,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    currentQuestion: remote.currentQuestion || null,
    votes,
    voteEndsAt: remote.voteEndsAt || null,
    roundScored: Boolean(remote.roundScored),
    modifier: remote.modifier || "normal",
  };
}

export function guessLieToRemote(gl) {
  return {
    sessionId: gl.sessionId,
    submissions: mapSubmissionsByUid(gl.submissions || {}),
    lobbyComplete: Boolean(gl.lobbyComplete),
    roundIdx: gl.roundIdx ?? 0,
    phase: gl.phase || null,
    votes: mapVotesByUid(gl.votes || {}),
    roundScored: Boolean(gl.roundScored),
  };
}

export function guessLieFromRemote(remote) {
  if (!remote) return null;
  return {
    sessionId: remote.sessionId,
    submissions: mapSubmissionsByName(remote.submissions || {}),
    lobbyComplete: Boolean(remote.lobbyComplete),
    currentRound: remote.roundIdx ?? 0,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    votes: mapVotesByName(remote.votes || {}),
    roundScored: Boolean(remote.roundScored),
  };
}

export function tierNightToRemote({ topicId, game, placements, finished }) {
  return {
    topicId: topicId || null,
    game: game || null,
    placements: mapPlacementsByUid(placements || {}),
    finished: finished || {},
  };
}

export function tierNightFromRemote(remote) {
  if (!remote) return null;
  return remote;
}

export function scoresToRemote(scoresByName = {}) {
  const out = {};
  Object.entries(scoresByName).forEach(([name, val]) => {
    const uid = userIdForName(name) || name;
    if (typeof val === "number" && Number.isFinite(val)) out[uid] = val;
  });
  return out;
}

function scoresFromRemote(remote = {}) {
  const out = {};
  Object.entries(remote).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    if (typeof val === "number" && Number.isFinite(val)) out[name] = val;
  });
  return out;
}

export function applyRemoteLobbyScores(remote) {
  if (!remote || typeof remote !== "object") return;
  const byName = scoresFromRemote(remote);
  if (!Object.keys(byName).length) return;

  const merged = { ...getState().scores };
  getLobbyParticipants().forEach((p) => {
    if (byName[p.name] != null) merged[p.name] = byName[p.name];
  });
  Object.entries(byName).forEach(([name, pts]) => {
    merged[name] = pts;
  });
  saveStatePatch({ scores: merged });
}

function eveningStateToRemote() {
  const { stats, lastGame, tierNightGame } = getState();
  return {
    scores: scoresToRemote(getState().scores),
    stats: {
      hotTakesPlayed: stats.hotTakesPlayed || 0,
      speedVotesPlayed: stats.speedVotesPlayed || 0,
      truthMetersPlayed: stats.truthMetersPlayed || 0,
      dilemmasPlayed: stats.dilemmasPlayed || 0,
      liesFound: stats.liesFound || 0,
      liesTotal: stats.liesTotal || 0,
      tierNightsPlayed: stats.tierNightsPlayed || 0,
    },
    lastGame: lastGame ? { ...lastGame } : null,
    lastTierName: tierNightGame?.listName || null,
  };
}

export function applyRemoteEveningState(st) {
  if (!st || typeof st !== "object") return;
  const patch = {};

  if (st.stats && typeof st.stats === "object") {
    patch.stats = { ...getState().stats, ...st.stats };
  }
  if (st.lastGame !== undefined) {
    patch.lastGame = st.lastGame;
  }
  if (st.lastTierName && getState().tierNightGame) {
    patch.tierNightGame = { ...getState().tierNightGame, listName: st.lastTierName };
  } else if (st.lastTierName) {
    patch.tierNightGame = { listName: st.lastTierName };
  }

  if (Object.keys(patch).length) saveStatePatch(patch);
  if (st.scores) applyRemoteLobbyScores(st.scores);
}

/** Hôte : pousse scores + stats de soirée vers game_sessions.state */
export async function syncLobbyScores() {
  if (!isGameSyncActive() || !isLobbyHost()) return;
  await patchGameState(eveningStateToRemote());
}

export function applyRemoteSession(row) {
  const prevScreen = cachedRow?.screen ?? null;
  const sig = sessionSignature(row);
  const sigUnchanged = sig === lastSessionSig;
  if (!sigUnchanged) lastSessionSig = sig;

  cachedRow = row;
  if (!row?.state) {
    notify(row);
    if (!row && isGameSyncActive()) {
      const current = getCurrentScreen();
      if (isActiveGameSessionScreen(current) || isOnGameSetupScreen(current)) {
        suppressSessionRoute(120000);
        void import("./lobby.js").then(({ goToLobby }) => goToLobby());
      } else if (isOnPostGameScreen(current)) {
        routeToSessionScreen("game-select", { force: true });
      }
    }
    return;
  }

  const patch = {};
  const st = row.state;

  if (st.hotTake) {
    const remote = hotTakeFromRemote(st.hotTake);
    const local = getState().hotTakeGame;
    patch.hotTakeGame = local ? mergeHotTakeGameLocal(local, remote) : remote;
  }
  if (st.speedVote) {
    const remote = speedVoteFromRemote(st.speedVote);
    const local = getState().speedVoteGame;
    patch.speedVoteGame = local ? mergeSpeedVoteGameLocal(local, remote) : remote;
  }
  if (st.truthMeter) {
    const remote = truthMeterFromRemote(st.truthMeter);
    const local = getState().truthMeterGame;
    patch.truthMeterGame = local ? mergeTruthMeterGameLocal(local, remote) : remote;
  }
  if (st.dilemma) {
    const remote = dilemmaFromRemote(st.dilemma);
    const local = getState().dilemmaGame;
    patch.dilemmaGame = local ? mergeDilemmaGameLocal(local, remote) : remote;
  }
  if (st.guessLie) {
    const gl = guessLieFromRemote(st.guessLie);
    patch.guessLie = gl;
  }
  if (st.tierNight) {
    const tn = tierNightFromRemote(st.tierNight);
    if (tn.topicId != null) patch.tierNightTopicId = tn.topicId;
    if (tn.game) patch.tierNightGame = tn.game;
  }
  if (st.filRouge) {
    const remote = filRougeFromRemote(st.filRouge);
    const local = getState().filRougeGame;
    patch.filRougeGame = local ? mergeFilRougeLocal(local, remote) : remote;
  }

  if (Object.keys(patch).length) saveStatePatch(patch);

  applyRemoteEveningState(st);

  notify(row);

  const effective = getEffectiveSessionScreen(row);
  const routingSuppressed = Date.now() < suppressSessionRouteUntil;
  const cur = getCurrentScreen();
  const followHost = shouldFollowHostGameLaunch(cur, effective);
  if (
    effective &&
    isActiveGameSessionScreen(effective) &&
    cur !== effective &&
    (!routingSuppressed || followHost)
  ) {
    if (followHost) clearSessionRouteSuppress();
    handleSessionRoute(row, { fromScreen: prevScreen });
  } else if (effective && (!sigUnchanged || cur !== effective)) {
    if (routingSuppressed && (cur === "home" || cur === "settings")) {
      return;
    }
    if (routingSuppressed && !shouldFollowHostGameLaunch(cur, effective)) {
      return;
    }
    handleSessionRoute(row, { fromScreen: prevScreen });
  }
}

export async function refreshGameSession() {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return null;
  const row = await fetchGameSessionByLobby(lobbyId);
  if (row) applyRemoteSession(row);
  else {
    cachedRow = null;
    notify(null);
  }
  return row;
}

function navStackFor(screen) {
  const base = ["home", "lobby", "game-select"];
  const gameScreens = new Set([
    "hottake-prep",
    "hottake",
    "speedvote-prep",
    "speedvote",
    "truthmeter-prep",
    "truthmeter",
    "guesslie-menu",
    "guesslie-setup",
    "guesslie-wait",
    "guesslie",
    "tiernight-select",
    "tiernight-create",
    "tiernight",
    "tiernight-end",
    "results",
  ]);
  if (gameScreens.has(screen)) return [...base, screen];
  return [...base, screen];
}

export function routeToSessionScreen(screen, { force = false } = {}) {
  if (!screen || routing) return;
  const current = getCurrentScreen();
  if (!force && current === screen) return;

  routing = true;
  try {
    if (screen === "game-select") {
      navigate("game-select", { navStack: navStackFor("game-select") });
    } else if (screen === "lobby") {
      navigate("lobby", { navStack: ["home", "lobby"] });
    } else if (screen === "results") {
      navigate("results", { navStack: navStackFor("results") });
    } else {
      navigate(screen, { navStack: navStackFor(screen) });
    }
  } finally {
    routing = false;
  }
}

export function suppressSessionRoute(ms = 45000, screen = getCachedGameSession()?.screen ?? null) {
  suppressSessionRouteUntil = Date.now() + ms;
  suppressSessionScreen = screen;
}

export function clearSessionRouteSuppress() {
  suppressSessionRouteUntil = 0;
  suppressSessionScreen = null;
}

export function isSessionRouteSuppressed() {
  return Date.now() < suppressSessionRouteUntil;
}

export function isActiveGameSessionScreen(screen) {
  if (!screen || MENU_SCREENS.has(screen)) return false;
  if (POST_GAME_SCREENS.has(screen)) return false;
  return true;
}

/** Écran réel de la partie (row.screen ou état jeu si le champ screen n’a pas été mis à jour). */
export function getEffectiveSessionScreen(row) {
  if (!row) return null;
  const declared = row.screen || null;
  const st = row.state || {};
  const gid = row.game_id || null;

  if (st.hotTake) {
    if (st.hotTake.lobbyStarted) return "hottake";
    if (gid === "hottake" || declared === "hottake-prep") return "hottake-prep";
  }
  if (st.speedVote) {
    if (st.speedVote.lobbyStarted) return "speedvote";
    if (gid === "speedvote" || declared === "speedvote-prep") return "speedvote-prep";
  }
  if (st.truthMeter) {
    if (st.truthMeter.lobbyStarted) return "truthmeter";
    if (gid === "truthmeter" || declared === "truthmeter-prep") return "truthmeter-prep";
  }
  if (st.dilemma) {
    if (st.dilemma.lobbyStarted) return "dilemma";
    if (gid === "dilemma" || declared === "dilemma-prep") return "dilemma-prep";
  }

  if (declared && (MENU_SCREENS.has(declared) || POST_GAME_SCREENS.has(declared))) {
    return declared;
  }

  const glPhase = st.guessLie?.phase;
  if (glPhase && glPhase !== "idle" && glPhase !== "lobby") return "guesslie";
  if (gid === "guesslie" || declared === "guesslie-menu") return "guesslie-menu";
  if (st.tierNight?.game && !st.tierNight?.finished) return "tiernight";
  return declared;
}

/** Renvoie l’invité (ou l’hôte) vers la partie en cours si une session active existe. */
export async function routeToActiveGameIfNeeded(cachedRowOnly = null) {
  if (!isGameSyncActive()) return false;
  const row =
    cachedRowOnly || (await refreshGameSession()) || getCachedGameSession();
  const screen = getEffectiveSessionScreen(row);
  if (!screen || !isActiveGameSessionScreen(screen)) return false;
  const current = getCurrentScreen();
  if (current === screen) return true;
  if (isCompatibleSessionScreen(screen, current)) return true;
  if (Date.now() < suppressSessionRouteUntil) {
    if (!shouldFollowHostGameLaunch(current, screen)) return false;
    clearSessionRouteSuppress();
  }
  routeToSessionScreen(screen, { force: true });
  return true;
}

export function handleSessionRoute(row, { fromScreen = null } = {}) {
  const screen = getEffectiveSessionScreen(row);
  if (!screen) return;
  const current = getCurrentScreen();
  if (screen === current) return;
  if (isCompatibleSessionScreen(screen, current)) return;

  const hostLaunchedFromMenu =
    fromScreen === "game-select" && screen !== "game-select";

  const sessionAdvanced =
    suppressSessionScreen != null && screen !== suppressSessionScreen;

  if (Date.now() < suppressSessionRouteUntil) {
    /** Accueil / paramètres : l’utilisateur est resté volontairement (profil, menu). */
    if (current === "home" || current === "settings") {
      return;
    }
    if (shouldFollowHostGameLaunch(current, screen) || hostLaunchedFromMenu || sessionAdvanced) {
      clearSessionRouteSuppress();
    } else {
      return;
    }
  }

  routeToSessionScreen(screen, { force: true });
}

/** Polling de secours si Realtime ne pousse pas l’événement (fréquent en local). */
async function syncTick() {
  if (!isGameSyncActive() || !getState().inLobby) {
    stopMultiplayerSync();
    return;
  }
  try {
    const row = await refreshGameSession();
    if (!row) return;
    if (await routeToActiveGameIfNeeded(row)) return;
    const local = getCurrentScreen();
    if (local !== row?.screen) handleSessionRoute(row);
  } catch (e) {
    console.warn("REVEAL sync:", e.message || e);
  }
}

export function startMultiplayerSync() {
  if (!isGameSyncActive()) return;
  stopMultiplayerSync();
  syncTick();
  pollTimer = setInterval(syncTick, 1500);
}

export function stopMultiplayerSync() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function startGameSession(gameId, screen, state) {
  if (!isGameSyncActive()) return null;
  const lobbyId = getState().lobby.id;
  const hostId = getSupabaseUserId();
  if (!hostId) throw new Error("Session requise.");

  const { setLobbyPlaying } = await import("./lobby.js");
  await setLobbyPlaying(gameId);
  const row = await upsertGameSession({
    lobbyId,
    gameId,
    screen,
    hostId,
    state: {
      ...eveningStateToRemote(),
      ...(state || {}),
    },
  });
  applyRemoteSession(row);
  routeToSessionScreen(screen, { force: true });
  return row;
}

export async function pushGameSession({ screen, gameId, state }) {
  if (!isGameSyncActive()) return null;
  const lobbyId = getState().lobby.id;
  const current = cachedRow?.state || {};
  const nextState = state ? { ...current, ...state } : current;
  const patch = { state: nextState };
  if (screen) patch.screen = screen;
  if (gameId) patch.game_id = gameId;

  const row = await updateGameSession(lobbyId, patch);
  applyRemoteSession(row);
  if (screen) handleSessionRoute(row);
  return row;
}

export async function patchGameState(stateMerge, { screen, gameId } = {}) {
  if (!isGameSyncActive()) return null;
  const lobbyId = getState().lobby.id;
  let freshRow = await fetchGameSessionByLobby(lobbyId);

  if (!freshRow) {
    const hostId = getSupabaseUserId();
    if (!hostId) throw new Error("Session requise.");
    if (isLobbyHost()) {
      freshRow = await upsertGameSession({
        lobbyId,
        gameId: gameId || "menu",
        screen: screen || "game-select",
        hostId,
        state: { ...eveningStateToRemote(), ...stateMerge },
      });
    } else {
      throw new Error(
        "Session de jeu introuvable. Demande à l'hôte de lancer la soirée depuis le lobby."
      );
    }
  }

  if (freshRow) {
    cachedRow = freshRow;
    lastSessionSig = sessionSignature(freshRow);
  }

  const current = freshRow?.state || cachedRow?.state || {};
  let nextState = { ...current, ...stateMerge };
  if (stateMerge.hotTake) {
    const curHt = current.hotTake;
    const incHt = stateMerge.hotTake;
    nextState.hotTake = curHt
      ? {
          ...curHt,
          ...incHt,
          ready: mergeRemoteReadyUid(curHt, incHt),
          votes: mergeRemoteHotTakeVotesUid(curHt, incHt),
        }
      : incHt;
  }
  if (stateMerge.speedVote) {
    const curSv = current.speedVote;
    const incSv = stateMerge.speedVote;
    nextState.speedVote = curSv
      ? {
          ...curSv,
          ...incSv,
          ready: mergeRemoteReadyUid(curSv, incSv),
          votes: mergeRemoteSpeedVoteVotesUid(curSv, incSv),
        }
      : incSv;
  }
  if (stateMerge.truthMeter) {
    const curTm = current.truthMeter;
    const incTm = stateMerge.truthMeter;
    nextState.truthMeter = curTm
      ? {
          ...curTm,
          ...incTm,
          ready: mergeRemoteReadyUid(curTm, incTm),
          votes: mergeRemoteTruthMeterVotesUid(curTm, incTm),
        }
      : incTm;
  }
  if (stateMerge.filRouge) {
    nextState.filRouge = mergeFilRougeRemote(current.filRouge, stateMerge.filRouge);
  }
  if (isLobbyHost()) {
    nextState = { ...nextState, ...eveningStateToRemote() };
  }

  const patch = { state: nextState };
  if (screen) patch.screen = screen;
  if (gameId) patch.game_id = gameId;

  let row = await updateGameSession(lobbyId, patch);
  if (!row) {
    row = await fetchGameSessionByLobby(lobbyId);
  }
  if (!row) {
    throw new Error("Impossible de synchroniser la partie (session introuvable).");
  }
  applyRemoteSession(row);
  if (screen) handleSessionRoute(row);
  return row;
}

export async function endGameSession() {
  if (!isGameSyncActive()) return;
  const lobbyId = getState().lobby.id;
  await deleteGameSession(lobbyId);
  cachedRow = null;
  lastSessionSig = "";
  const { setLobbyWaiting } = await import("./lobby.js");
  await setLobbyWaiting();
  notify(null);
}

/** Fin de partie : écran résultats pour tout le lobby (upsert, pas delete+update). */
export async function completeGameSession({ gameId = "menu", screen = "results", state = {} } = {}) {
  if (!isGameSyncActive()) return null;
  const lobbyId = getState().lobby.id;
  const hostId = getSupabaseUserId();
  if (!hostId) return null;

  const { setLobbyWaiting } = await import("./lobby.js");
  await setLobbyWaiting();

  const row = await upsertGameSession({
    lobbyId,
    gameId,
    screen,
    hostId,
    state: {
      ...eveningStateToRemote(),
      ...(state || {}),
    },
  });
  applyRemoteSession(row);
  routeToSessionScreen(screen, { force: true });
  return row;
}

function resetLocalGamePrepState() {
  resetEveningState();
}

/** Vide le cache session multijoueur (après quit lobby). */
export function clearCachedGameSession() {
  cachedRow = null;
  lastSessionSig = "";
  notify(null);
}

export function isOnPostGameScreen(screen = getCurrentScreen()) {
  return POST_GAME_SCREENS.has(screen);
}

/** Retour au menu jeux (hôte : ferme la session ; invité : navigation locale). */
export async function returnToGameSelect() {
  if (!isGameSyncActive()) return false;

  if (isLobbyHost()) {
    await endGameSession();
    resetLocalGamePrepState();
    routeToSessionScreen("game-select", { force: true });
    return true;
  }

  suppressSessionRoute();
  navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
  return true;
}

/** Quitter la préparation d’un jeu (retour au menu jeux) — multijoueur. */
export async function leaveGameSetup() {
  if (!isGameSyncActive() || !isLobbyHost()) return false;
  return returnToGameSelect();
}

export async function syncHotTakeSession(extra = {}) {
  const session = { ...getState().hotTakeGame, ...extra };
  saveStatePatch({ hotTakeGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ hotTake: hotTakeToRemote(session) });
  return session;
}

export async function syncSpeedVoteSession(extra = {}) {
  const session = { ...getState().speedVoteGame, ...extra };
  saveStatePatch({ speedVoteGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ speedVote: speedVoteToRemote(session) });
  return session;
}

export async function syncTruthMeterSession(extra = {}) {
  const session = { ...getState().truthMeterGame, ...extra };
  saveStatePatch({ truthMeterGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ truthMeter: truthMeterToRemote(session) });
  return session;
}

export async function syncDilemmaSession(extra = {}) {
  const session = { ...getState().dilemmaGame, ...extra };
  saveStatePatch({ dilemmaGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ dilemma: dilemmaToRemote(session) });
  return session;
}

export async function syncFilRougeSession(extra = {}) {
  const session = { ...getState().filRougeGame, ...extra };
  if (!isGameSyncActive()) {
    saveStatePatch({ filRougeGame: session });
    return session;
  }
  await patchGameState({ filRouge: filRougeToRemote(session) });
  return getState().filRougeGame || session;
}

export async function syncGuessLieSession(extra = {}) {
  const gl = { ...getState().guessLie, ...extra };
  saveStatePatch({ guessLie: gl });
  if (!isGameSyncActive()) return gl;
  await patchGameState({ guessLie: guessLieToRemote(gl) });
  return gl;
}

export async function commitGuessLiePlay(patch, { screen } = {}) {
  const gl = await syncGuessLieSession(patch);
  if (screen && isGameSyncActive()) {
    await pushGameSession({ screen, gameId: "guesslie", state: { guessLie: guessLieToRemote(gl) } });
  }
  return gl;
}

export async function syncTierNightSession(payload) {
  if (payload.topicId != null) saveStatePatch({ tierNightTopicId: payload.topicId });
  if (payload.game) saveStatePatch({ tierNightGame: payload.game });
  if (!isGameSyncActive()) return;
  const cached = getTierNightRemote() || {};
  const remote = tierNightToRemote({
    topicId: payload.topicId ?? getState().tierNightTopicId,
    game: payload.game ?? getState().tierNightGame,
    placements: payload.placements ?? cached.placements,
    finished: payload.finished ?? cached.finished,
  });
  await patchGameState({ tierNight: remote }, { screen: payload.screen, gameId: "tiernight" });
}

export function getActiveMemberUserIds() {
  return (getState().lobby?.participants || [])
    .map((p) => p.userId)
    .filter(Boolean);
}

export function allMembersReady(readyMapByUid) {
  const ids = getActiveMemberUserIds();
  if (!ids.length) return false;
  return ids.every((id) => readyMapByUid[id]);
}

export function getTierNightRemote() {
  return getCachedGameSession()?.state?.tierNight || null;
}

export function getTierNightLobbyProgress() {
  const finished = getTierNightRemote()?.finished || {};
  return getLobbyParticipants().map((p) => ({
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    userId: p.userId,
    done: Boolean(p.userId && finished[p.userId]),
  }));
}

export function allTierNightMembersFinished(finishedMap) {
  const ids = getActiveMemberUserIds();
  if (!ids.length) return false;
  const map = finishedMap ?? getTierNightRemote()?.finished ?? {};
  return ids.every((id) => map[id]);
}

export function ensureTierNightRecapsFromRemote(list) {
  const session = getTierNightSession();
  if (session.topicId === list.id && (session.recaps?.length || 0) > 0) return;

  const tn = getTierNightRemote();
  if (!tn) return;

  const placements = tn.placements || {};
  const byName = {};
  getLobbyParticipants().forEach((p) => {
    if (p.userId && placements[p.userId]) byName[p.name] = placements[p.userId];
  });

  buildRecapsFromPlacements(list.id, list.name, list.items, byName);
  recordTierNightPlayed();
}

/** Hôte uniquement : passe à l’écran résultats quand tout le lobby a terminé. */
export async function advanceTierNightToResultsWhenReady(list) {
  if (!isGameSyncActive() || !isLobbyHost()) return false;
  if (!allTierNightMembersFinished()) return false;

  ensureTierNightRecapsFromRemote(list);
  await pushGameSession({ screen: "tiernight-end", gameId: "tiernight", state: {} });
  navigate("tiernight-end");
  return true;
}

export function allMembersVoted(votesByUid, options = {}) {
  const { excludeUserId = null } = options;
  const ids = getActiveMemberUserIds().filter((id) => id !== excludeUserId);
  if (!ids.length) return false;
  return ids.every((id) => votesByUid[id] != null && votesByUid[id] !== "");
}

export function initGameSyncFromLobby(row) {
  if (row) applyRemoteSession(row);
}
