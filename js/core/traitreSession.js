import {
  TRAITRE_MIN_PLAYERS,
  pickRandomTraitrePair,
  getTraitrePairById,
} from "../../data/traitre.js";
import {
  buildTraitreEliminationPatch,
  computeTraitreScoreDeltas,
} from "./traitreScoring.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import {
  addScore,
  bumpPlayerStat,
  getLocalDisplayName,
  getState,
  saveStatePatch,
} from "./state.js";
import {
  allMembersReady,
  isGameSyncActive,
  isLobbyHost,
  nameForUserId,
  requireLocalParticipantUid,
  requirePlayerUid,
  syncTraitreSession,
  traitreToRemote,
  userIdForName,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { hostDistributeTraitreRoles } from "./traitrePrivate.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { withPatchTimeout } from "./withPatchTimeout.js";
import { SYNC_PATCH_TIMEOUT_MS } from "../config/syncConfig.js";
import { normalizeKeyedVotes, traitreKnownImpostorFlag } from "./sessionMerge.js";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "./optimisticMapEntry.js";

let traitreVoteAttemptId = 0;
let traitreDealAckAttemptId = 0;

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    phase: null,
    pairId: null,
    impostorName: null,
    isLocalImpostor: null,
    privateRolePairId: null,
    privateRoleNonce: 0,
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
    matchId: null,
    privateRoleMatchId: null,
    privateRoleSynced: false,
  };
}

export function isTraitrePrivateRoleReady(session = getTraitreSession()) {
  return traitreKnownImpostorFlag(session, { offline: !isGameSyncActive() }) !== null;
}

/** Phase « deal » : rôle privé + paire de mots résolue (évite l'affichage « … »). */
export function isTraitreWordDealReady(session = getTraitreSession()) {
  if (!isTraitrePrivateRoleReady(session)) return false;
  return Boolean(getMyTraitreWord(session));
}

export function defaultTraitrePrepSession() {
  return defaultSession();
}

export function getTraitreSession() {
  return getState().traitreGame || defaultSession();
}

export function isLocalTraitreHost() {
  return isLobbyHost();
}

export function getTraitrePair(session = getTraitreSession()) {
  return getTraitrePairById(session.pairId);
}

/** Paire de mots figée pour l'écran résultat (évite une fuite si pairId change). */
export function getTraitreResultPair(session = getTraitreSession()) {
  const pairId = session.lastRound?.pairId ?? session.pairId;
  return getTraitrePairById(pairId);
}

export function getMyTraitreWord(session = getTraitreSession()) {
  const pair = getTraitrePair(session);
  if (!pair) return null;
  const amImpostor = traitreKnownImpostorFlag(session, { offline: !isGameSyncActive() });
  if (amImpostor === null) return null;
  return amImpostor ? pair.b : pair.a;
}

export function getTraitreSpeakOrder(session = getTraitreSession()) {
  const alive = [...(session.alive || [])];
  if (!alive.length) return [];
  const offset = ((session.speakRound || 1) - 1) % alive.length;
  return [...alive.slice(offset), ...alive.slice(0, offset)];
}

export function getCurrentTraitreSpeaker(session = getTraitreSession()) {
  const order = getTraitreSpeakOrder(session);
  const idx = session.speakerIndex || 0;
  return order[idx] ?? null;
}

export function allTraitreReady() {
  const session = getTraitreSession();
  if (isGameSyncActive()) {
    return allMembersReady(traitreToRemote(session).ready || {});
  }
  return getActivePlayerNames().every((name) => session.ready?.[name]);
}

export async function setTraitreReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getTraitreSession,
    saveLocal: (session) => saveStatePatch({ traitreGame: session }),
    stateKey: "traitre",
    gameId: "traitre",
    screen: "traitre-prep",
  });
}

export function simulateTraitreReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    void setTraitreReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export function validateTraitreLaunch(rosterNames) {
  const count = rosterNames?.length ?? getActivePlayerNames().length;
  return {
    ok: count >= TRAITRE_MIN_PLAYERS,
    count,
    min: TRAITRE_MIN_PLAYERS,
  };
}

export function createStartedTraitreSession(rosterNames) {
  const names = rosterNames?.length ? rosterNames : getActivePlayerNames();
  const check = validateTraitreLaunch(names);
  if (!check.ok) return { ok: false, ...check };
  const pair = pickRandomTraitrePair();
  const impostorName = names[Math.floor(Math.random() * names.length)];
  const localName = getLocalDisplayName();
  const matchId = globalThis.crypto.randomUUID();
  return {
    ok: true,
    session: {
      ...defaultSession(),
      matchId,
      privateRoleMatchId: matchId,
      lobbyStarted: true,
      phase: "deal",
      pairId: pair.id,
      impostorName,
      isLocalImpostor: impostorName === localName,
      privateRoleSynced: true,
      privateRolePairId: pair.id,
      privateRoleNonce: (getTraitreSession().privateRoleNonce || 0) + 1,
      alive: [...names],
      eliminated: [],
      speakRound: 1,
      speakerIndex: 0,
      voteSurvivals: 0,
      dealAcks: {},
      votes: {},
    },
  };
}

async function distributeTraitreRolesForHost(session) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) {
    throw new Error("Lobby introuvable.");
  }
  if (!session?.matchId) {
    return {
      ok: false,
      written: 0,
      skippedNames: [],
      error: "matchId manquant.",
    };
  }
  return hostDistributeTraitreRoles(
    session.matchId,
    session.pairId,
    session.impostorName,
    session.alive
  );
}

/** Jeton interne : ne pas le confondre avec un message d'erreur Supabase. */
const TRAITRE_ROLE_DISTRIBUTION_TIMEOUT = "TRAITRE_ROLE_DISTRIBUTION_TIMEOUT";

const TRAITRE_ROLE_INCOMPLETE_MESSAGE =
  "La distribution des rôles n'a pas abouti. La manche n'a pas démarré.";

const TRAITRE_ROLE_TIMEOUT_MESSAGE =
  "La distribution des rôles n'a pas été confirmée à temps. La manche n'a pas démarré.";

function traitreLaunchRefusal(reason) {
  return { ok: false, reason };
}

async function alertTraitreLaunchRefusal(message) {
  const { showAppAlert } = await import("./dialog.js");
  await showAppAlert(message, { title: "Spot the fake", icon: "🎭" });
}

function repeatedAliveNames(names) {
  const counts = new Map();
  for (const name of names) {
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

/**
 * Même résolution que l'écriture : `userIdForName` reprend le userId du
 * participant, puis l'uid local si le pseudo est celui du joueur de cet appareil.
 * Les pseudos du lobby sont uniques (index insensible à la casse).
 */
function inspectTraitreAliveIdentities(names) {
  if (!Array.isArray(names) || names.length === 0) {
    return { ok: false, reason: "invalid_roster" };
  }
  if (names.some((name) => typeof name !== "string" || name.trim() === "")) {
    return { ok: false, reason: "invalid_roster" };
  }
  const duplicateNames = repeatedAliveNames(names);
  if (duplicateNames.length) {
    return { ok: false, reason: "duplicate_names", names: duplicateNames };
  }
  const missing = [];
  const namesByUid = new Map();
  for (const name of names) {
    const uid = userIdForName(name);
    if (!uid) {
      missing.push(name);
      continue;
    }
    const group = namesByUid.get(uid) || [];
    group.push(name);
    namesByUid.set(uid, group);
  }
  if (missing.length) {
    return { ok: false, reason: "missing_uid", names: missing };
  }
  const shared = [];
  for (const group of namesByUid.values()) {
    if (group.length > 1) shared.push(...group);
  }
  if (shared.length) {
    return { ok: false, reason: "duplicate_uid", names: shared };
  }
  return { ok: true };
}

function traitreIdentityRefusalMessage(check) {
  const listed = (check.names || []).join(", ");
  if (check.reason === "missing_uid") {
    return `Ces joueurs n'ont pas d'identité synchronisée : ${listed}. La manche n'a pas démarré.`;
  }
  return `Identité ambiguë pour : ${listed}. La manche n'a pas démarré.`;
}

function isConfirmedTraitreDistribution(dist, expected) {
  if (!dist || typeof dist !== "object" || Array.isArray(dist)) return false;
  if (dist.ok !== true) return false;
  if (Object.prototype.hasOwnProperty.call(dist, "error") && dist.error != null) return false;
  if (dist.skippedNames != null && (!Array.isArray(dist.skippedNames) || dist.skippedNames.length > 0)) {
    return false;
  }
  return dist.written === expected;
}

async function refuseTraitreLaunchIfRolesUnconfirmed(next) {
  const names = next?.alive;
  const identity = inspectTraitreAliveIdentities(names);
  if (!identity.ok) {
    const message =
      identity.reason === "missing_uid" ||
      identity.reason === "duplicate_names" ||
      identity.reason === "duplicate_uid"
        ? traitreIdentityRefusalMessage(identity)
        : TRAITRE_ROLE_INCOMPLETE_MESSAGE;
    await alertTraitreLaunchRefusal(message);
    return traitreLaunchRefusal(identity.reason);
  }
  if (!names.includes(next.impostorName)) {
    await alertTraitreLaunchRefusal(TRAITRE_ROLE_INCOMPLETE_MESSAGE);
    return traitreLaunchRefusal("impostor_not_in_roster");
  }

  let dist;
  try {
    dist = await withPatchTimeout(
      distributeTraitreRolesForHost(next),
      SYNC_PATCH_TIMEOUT_MS,
      TRAITRE_ROLE_DISTRIBUTION_TIMEOUT
    );
  } catch (error) {
    console.warn("REVEAL traitre roles:", error);
    if (error?.message === TRAITRE_ROLE_DISTRIBUTION_TIMEOUT) {
      await alertTraitreLaunchRefusal(TRAITRE_ROLE_TIMEOUT_MESSAGE);
      return traitreLaunchRefusal("timeout");
    }
    await alertTraitreLaunchRefusal(TRAITRE_ROLE_INCOMPLETE_MESSAGE);
    return traitreLaunchRefusal("distribution_failed");
  }

  if (isConfirmedTraitreDistribution(dist, names.length)) return null;

  if (Array.isArray(dist?.skippedNames) && dist.skippedNames.length > 0) {
    await alertTraitreLaunchRefusal(
      traitreIdentityRefusalMessage({ reason: "missing_uid", names: dist.skippedNames })
    );
    return traitreLaunchRefusal("missing_uid");
  }
  await alertTraitreLaunchRefusal(TRAITRE_ROLE_INCOMPLETE_MESSAGE);
  return traitreLaunchRefusal(
    !dist || typeof dist !== "object" || Array.isArray(dist)
      ? "unreadable_result"
      : "distribution_incomplete"
  );
}

export async function markTraitreLobbyStarted({ rosterNames } = {}) {
  const started = createStartedTraitreSession(rosterNames);
  if (!started.ok) return started;

  const next = {
    ...started.session,
    privateRoleSynced: !isGameSyncActive() || isLobbyHost(),
  };

  if (isGameSyncActive() && isLobbyHost()) {
    const refusal = await refuseTraitreLaunchIfRolesUnconfirmed(next);
    if (refusal) return refusal;
  }

  // L'écho du push fusionne et peint l'écran avant le applyLocal de fin.
  // Le rôle hôte doit déjà être dans le state, sinon ce premier rendu le voit invalidé.
  const result = await launchGameWithSync({
    screen: "traitre",
    gameId: "traitre",
    mode: "push",
    localFirst: true,
    applyLocal: () => saveStatePatch({ traitreGame: next }),
    getRemoteState: () => ({ traitre: traitreToRemote(next) }),
  });
  return { ...result, ok: result.ok !== false, session: next };
}

export async function commitTraitrePlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "traitre",
    screen: "traitre",
    stateKey: "traitre",
    getSession: getTraitreSession,
    saveLocal: (session) => saveStatePatch({ traitreGame: session }),
    toRemote: traitreToRemote,
    patchOpts,
  });
}

/**
 * MP : ACK phase deal (mot mémorisé). Optimistic write + rollback conditionnel.
 * Idempotent côté serveur (jsonb_set true→true). Utilisé pour allTraitreDealAcksIn → speak.
 */
export async function commitTraitreDealAck() {
  const localName = getLocalDisplayName();
  const session = getTraitreSession();
  if (session.phase != null && session.phase !== "deal") {
    return session.dealAcks || {};
  }
  if (session.dealAcks?.[localName] === true) {
    return session.dealAcks;
  }

  const attemptId = ++traitreDealAckAttemptId;
  const captured = { phase: session.phase ?? "deal" };
  const apply = computeOptimisticMapEntryApply({
    map: session.dealAcks,
    key: localName,
    value: true,
  });
  saveStatePatch({ traitreGame: { ...session, dealAcks: apply.nextMap } });
  if (!isGameSyncActive()) return apply.nextMap;

  try {
    const uid = requireLocalParticipantUid();
    await patchGameStateWithFeedback({ traitre: { dealAcks: { [uid]: true } } });
    return apply.nextMap;
  } catch (err) {
    const live = getTraitreSession();
    if (
      attemptId === traitreDealAckAttemptId &&
      canRollbackOptimisticSubmission(captured, live)
    ) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: live.dealAcks,
        key: localName,
        hadPreviousValue: apply.hadPreviousValue,
        previousValue: apply.previousValue,
        optimisticValue: apply.optimisticValue,
        attemptId,
        currentAttemptId: traitreDealAckAttemptId,
      });
      if (rolled.applied) {
        saveStatePatch({ traitreGame: { ...live, dealAcks: rolled.map } });
      }
    }
    throw err;
  }
}

export function __resetTraitreDealAckAttemptIdForTests() {
  traitreDealAckAttemptId = 0;
}

export async function commitTraitreVote(targetName) {
  const localName = getLocalDisplayName();
  const session = getTraitreSession();
  if (session.phase !== "vote") return null;
  const alive = session.alive || [];
  if (!alive.includes(localName) || !alive.includes(targetName)) return null;

  const attemptId = ++traitreVoteAttemptId;
  const captured = { phase: session.phase };
  const apply = computeOptimisticMapEntryApply({
    map: session.votes,
    key: localName,
    value: targetName,
  });
  saveStatePatch({ traitreGame: { ...session, votes: apply.nextMap } });
  if (!isGameSyncActive()) return targetName;

  try {
    const uid = requireLocalParticipantUid();
    const targetUid = requirePlayerUid(targetName);
    await patchGameStateWithFeedback({ traitre: { votes: { [uid]: targetUid } } });
    return targetName;
  } catch (err) {
    const live = getTraitreSession();
    if (
      attemptId === traitreVoteAttemptId &&
      canRollbackOptimisticSubmission(captured, live)
    ) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: live.votes,
        key: localName,
        hadPreviousValue: apply.hadPreviousValue,
        previousValue: apply.previousValue,
        optimisticValue: apply.optimisticValue,
        attemptId,
        currentAttemptId: traitreVoteAttemptId,
      });
      if (rolled.applied) {
        saveStatePatch({ traitreGame: { ...live, votes: rolled.map } });
      }
    }
    throw err;
  }
}

export function __resetTraitreVoteAttemptIdForTests() {
  traitreVoteAttemptId = 0;
}

export function allTraitreDealAcksIn(session = getTraitreSession()) {
  const alive = session.alive || getActivePlayerNames();
  return alive.length > 0 && alive.every((name) => session.dealAcks?.[name]);
}

export function countTraitreDealAcks(session = getTraitreSession()) {
  const alive = session.alive || getActivePlayerNames();
  return alive.filter((name) => session.dealAcks?.[name]).length;
}

/** Votes indexés par pseudo (sync multijoueur peut envoyer des UUID). */
export function normalizeTraitreVotes(votes = {}, alive = []) {
  const activeNames = getActivePlayerNames();
  return normalizeKeyedVotes(votes, alive, (key) => {
    const mapped = nameForUserId(key);
    if (mapped) return mapped;
    const s = String(key);
    if (alive.includes(s)) return s;
    if (activeNames.includes(s)) return s;
    return null;
  });
}

export function getTraitrePendingVoters(session = getTraitreSession()) {
  const alive = session.alive || [];
  const normalized = normalizeTraitreVotes(session.votes || {}, alive);
  return alive.filter((name) => !normalized[name]);
}

export function countTraitreVotesCast(votes = {}, alive = []) {
  const normalized = normalizeTraitreVotes(votes, alive);
  return alive.filter((name) => normalized[name]).length;
}

export function allTraitreVotesIn(session = getTraitreSession()) {
  const alive = session.alive || [];
  const votes = normalizeTraitreVotes(session.votes || {}, alive);
  return alive.length > 0 && alive.every((name) => votes[name] != null && votes[name] !== "");
}

export function countTraitreVotes(votes = {}, alive = []) {
  const normalized = normalizeTraitreVotes(votes, alive);
  const counts = {};
  alive.forEach((name) => {
    const target = normalized[name];
    if (!target || !alive.includes(target)) return;
    counts[target] = (counts[target] || 0) + 1;
  });
  let max = 0;
  Object.values(counts).forEach((n) => {
    if (n > max) max = n;
  });
  const leaders = Object.entries(counts)
    .filter(([, n]) => n === max && max > 0)
    .map(([name]) => name);
  return {
    counts,
    leaders,
    maxVotes: max,
    isTie: leaders.length > 1,
  };
}

export {
  buildTraitreEliminationPatch,
  buildTraitreTieSpeakPatch,
  computeTraitreScoreDeltas,
} from "./traitreScoring.js";

/** Manche d'indices après égalité au vote (bandeau visible pour tout le lobby). */
export function isTraitreTieSpeakRound(session = getTraitreSession()) {
  return session.phase === "speak" && Boolean(session.tieAfterVote);
}

export function awardTraitreGame(session = getTraitreSession()) {
  if (session.scoresApplied) return session;

  const scored = computeTraitreScoreDeltas(session);
  const { deltas, breakdown } = scored;
  const impostor = session.impostorName;

  Object.entries(deltas).forEach(([name, pts]) => {
    if (pts <= 0) return;
    addScore(name, pts);
    if (name !== impostor && breakdown[name]?.some((b) => b.label === "Détective")) {
      bumpPlayerStat(name, "traitreDetections", 1);
    }
  });

  if (session.winner === "traitre" && impostor && (deltas[impostor] || 0) > 0) {
    bumpPlayerStat(impostor, "traitreWins", 1);
  }

  const summary = {
    ...scored,
    deltas,
    breakdown,
  };

  const updated = {
    ...session,
    scoresApplied: true,
    lastRound: summary,
  };
  saveStatePatch({ traitreGame: updated });
  return updated;
}

export function getTraitreEntryScreen() {
  const session = getTraitreSession();
  return session.lobbyStarted ? "traitre" : "traitre-prep";
}

export function getTraitreVoteTargets(session = getTraitreSession()) {
  return getActivePlayers().filter((p) => (session.alive || []).includes(p.name));
}

export function simulateTraitreVotes(localTarget, session = getTraitreSession()) {
  const result = {};
  const local = getLocalDisplayName();
  const alive = session.alive || [];
  result[local] = localTarget;
  alive.forEach((name) => {
    if (name === local) return;
    const pool = alive.filter((n) => n !== name);
    if (!pool.length) return;
    result[name] = pool[Math.floor(Math.random() * pool.length)];
  });
  return result;
}
