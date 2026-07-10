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
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import {
  clearTraitrePrivateForLobby,
  hostDistributeTraitreRoles,
} from "./traitrePrivate.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { normalizeKeyedVotes } from "./sessionMerge.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    phase: null,
    pairId: null,
    impostorName: null,
    isLocalImpostor: false,
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
    privateRoleSynced: false,
  };
}

export function isTraitrePrivateRoleReady(session = getTraitreSession()) {
  if (!isGameSyncActive()) return true;
  if (isLobbyHost()) return true;
  return Boolean(session.privateRoleSynced);
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
  const me = getLocalDisplayName();
  const amImpostor =
    session.isLocalImpostor === true || (session.impostorName && session.impostorName === me);
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
  return {
    ok: true,
    session: {
      ...defaultSession(),
      lobbyStarted: true,
      phase: "deal",
      pairId: pair.id,
      impostorName,
      isLocalImpostor: impostorName === localName,
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
  await clearTraitrePrivateForLobby(lobbyId);
  return hostDistributeTraitreRoles(session.pairId, session.impostorName, session.alive);
}

export async function markTraitreLobbyStarted({ rosterNames } = {}) {
  const started = createStartedTraitreSession(rosterNames);
  if (!started.ok) return started;

  const next = {
    ...started.session,
    privateRoleSynced: !isGameSyncActive() || isLobbyHost(),
  };

  if (isGameSyncActive() && isLobbyHost()) {
    try {
      const dist = await distributeTraitreRolesForHost(next);
      if (!dist.ok) {
        const { showAppAlert } = await import("./dialog.js");
        await showAppAlert(
          dist.error ||
            "Impossible d'enregistrer les rôles secrets. Vérifie Supabase (traitre_private).",
          { title: "Spot the fake", icon: "🎭" }
        );
      } else if (dist.error) {
        const { showAppAlert } = await import("./dialog.js");
        await showAppAlert(dist.error, { title: "Spot the fake", icon: "⚠️" });
      }
    } catch (e) {
      console.warn("REVEAL traitre roles:", e);
      const { showAppAlert } = await import("./dialog.js");
      await showAppAlert(
        e.message ||
          "Impossible d'enregistrer les rôles secrets. Vérifie que traitre-private.sql est appliqué sur Supabase.",
        { title: "Spot the fake", icon: "🎭" }
      );
    }
  }

  const result = await launchGameWithSync({
    screen: "traitre",
    gameId: "traitre",
    mode: "push",
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

export async function commitTraitreDealAck() {
  const localName = getLocalDisplayName();
  const session = getTraitreSession();
  const dealAcks = { ...(session.dealAcks || {}), [localName]: true };
  saveStatePatch({ traitreGame: { ...session, dealAcks } });
  if (!isGameSyncActive()) return dealAcks;
  const uid = requireLocalParticipantUid();
  await patchGameStateWithFeedback({ traitre: { dealAcks: { [uid]: true } } });
  return dealAcks;
}

export async function commitTraitreVote(targetName) {
  const localName = getLocalDisplayName();
  const session = getTraitreSession();
  if (session.phase !== "vote") return null;
  const alive = session.alive || [];
  if (!alive.includes(localName) || !alive.includes(targetName)) return null;
  const votes = { ...(session.votes || {}), [localName]: targetName };
  saveStatePatch({ traitreGame: { ...session, votes } });
  if (!isGameSyncActive()) return targetName;
  const uid = requireLocalParticipantUid();
  const targetUid = requirePlayerUid(targetName);
  await patchGameStateWithFeedback({ traitre: { votes: { [uid]: targetUid } } });
  return targetName;
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

export { buildTraitreEliminationPatch, computeTraitreScoreDeltas } from "./traitreScoring.js";

/** Manche d'indices après égalité au vote (bandeau visible pour tout le lobby). */
export function isTraitreTieSpeakRound(session = getTraitreSession()) {
  return session.phase === "speak" && Boolean(session.tieAfterVote);
}

/** Égalité au vote : nouveau tour d'indices (mêmes mots, mêmes rôles). */
export function buildTraitreTieSpeakPatch(session) {
  return {
    phase: "speak",
    speakRound: (session.speakRound || 1) + 1,
    speakerIndex: 0,
    votes: {},
    revotePending: false,
    revoteCount: 0,
    tieAfterVote: true,
  };
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
