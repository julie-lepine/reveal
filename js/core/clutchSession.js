import {
  CLUTCH_GRACE_MS,
  pickClutchTarget,
  pickClutchHideBefore,
} from "../../data/clutch.js";
import { getActivePlayerNames } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  syncClutchSession,
  allMembersReady,
  clutchToRemote,
  requireLocalParticipantUid,
  patchGameState,
} from "./gameSync.js";
import { formatSyncErrorMessage } from "./authErrors.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { freezeClutchTap } from "./clutchTapCommit.js";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "./optimisticMapEntry.js";
import {
  buildClutchParticipantsSnapshot,
  resolveClutchParticipantNames,
  clutchAllTapsIn,
  rankClutchEntries,
  sessionHasClutchParticipantSnapshot,
} from "./clutchParticipants.js";
import { estimateClutchDuration } from "./clutchDuration.js";

/** Génération commit tap (stale catch / AUDIT-003). */
let clutchTapAttemptId = 0;

export {
  buildClutchParticipantsSnapshot,
  normalizeClutchParticipantEntries,
  resolveClutchParticipantNames,
  clutchAllTapsIn,
  rankClutchEntries,
  sessionHasClutchParticipantSnapshot,
  migrateClutchParticipantsRename,
} from "./clutchParticipants.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    roundCount: 5,
    roundIdx: 0,
    phase: null,
    targetMs: null,
    roundStartAt: null,
    roundEndsAt: null,
    taps: {},
    roundScored: false,
    matchScores: {},
    lastRound: null,
    participants: [],
  };
}

export function getClutchSession() {
  return getState().clutchGame || defaultSession();
}

export function defaultClutchPrepSession() {
  return defaultSession();
}

export function getClutchRoundCount() {
  return getClutchSession().roundCount ?? 5;
}

export async function setClutchRoundCount(count) {
  const session = getClutchSession();
  await syncClutchSession({ ...session, roundCount: count });
}

export function getClutchPrepSummary() {
  const requested = getClutchRoundCount();
  const duration = estimateClutchDuration(requested);
  return {
    requested,
    effective: requested,
    durationLabel: duration.label,
  };
}

/** Charge utile d'une nouvelle manche : cible + masquage aléatoires + fenêtre de clôture. */
function roundPayload(roundIdx) {
  const targetMs = pickClutchTarget();
  const hideBeforeMs = pickClutchHideBefore();
  const startAt = Date.now();
  return {
    roundIdx,
    phase: "active",
    targetMs,
    hideBeforeMs,
    roundStartAt: new Date(startAt).toISOString(),
    roundEndsAt: new Date(startAt + targetMs + CLUTCH_GRACE_MS).toISOString(),
    taps: {},
    roundScored: false,
    lastRound: null,
  };
}

function resolveLiveNameByUserId(uid) {
  if (!uid) return null;
  const p = getLobbyParticipants().find((x) => x.userId === uid);
  return p?.name || null;
}

/**
 * UX-CLUTCH-01 - participants de la session (snapshot), pas le lobby live.
 * Legacy sans snapshot → actifs (compat uniquement).
 */
export function getClutchParticipantNames(session = getClutchSession()) {
  return resolveClutchParticipantNames(session, {
    activeNames: getActivePlayerNames(),
    resolveNameByUserId: resolveLiveNameByUserId,
  });
}

/**
 * @param {{ rosterNames: string[] }} opts - obligatoire au lancement (force + normal).
 * Pas de fallback silencieux vers le lobby : l’appelant doit transmettre le roster.
 */
export async function markClutchLobbyStarted({ rosterNames } = {}) {
  const roster = Array.isArray(rosterNames)
    ? rosterNames.map((n) => String(n || "").trim()).filter(Boolean)
    : [];
  if (!roster.length) {
    throw new Error("CLUTCH_ROSTER_REQUIRED");
  }
  const participants = buildClutchParticipantsSnapshot(roster, getLobbyParticipants());
  if (!participants.length) {
    throw new Error("CLUTCH_ROSTER_REQUIRED");
  }
  const next = {
    ...getClutchSession(),
    lobbyStarted: true,
    ...roundPayload(0),
    participants,
  };
  return launchGameWithSync({
    screen: "clutch",
    gameId: "clutch",
    mode: "push",
    applyLocal: () => saveStatePatch({ clutchGame: next }),
    getRemoteState: () => ({ clutch: clutchToRemote(next) }),
  });
}

export async function startClutchRound(roundIdx) {
  const next = {
    ...getClutchSession(),
    ...roundPayload(roundIdx),
  };
  await syncClutchSession(next);
  return next;
}

export async function commitClutchPlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "clutch",
    stateKey: "clutch",
    getSession: getClutchSession,
    saveLocal: (session) => saveStatePatch({ clutchGame: session }),
    toRemote: clutchToRemote,
    patchOpts,
  });
}

export async function setClutchReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getClutchSession,
    saveLocal: (session) => saveStatePatch({ clutchGame: session }),
    stateKey: "clutch",
    gameId: "clutch",
    screen: "clutch-prep",
  });
}

export function allClutchReady() {
  const session = getClutchSession();
  if (isGameSyncActive()) {
    const remote = clutchToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

/** MP : envoie le tap figé au clic ({ ms, at }). Aucun recalcul. Rollback ciblé si sync échoue. */
export async function commitClutchTap(tapInput) {
  const localName = getLocalDisplayName();
  const session = getClutchSession();
  const existing = session.taps?.[localName];
  if (existing?.ms != null) return existing;

  const resolved = freezeClutchTap(tapInput);
  const attemptId = ++clutchTapAttemptId;
  const captured = { phase: session.phase, roundIdx: session.roundIdx };
  const apply = computeOptimisticMapEntryApply({
    map: session.taps,
    key: localName,
    value: resolved,
  });
  saveStatePatch({ clutchGame: { ...session, taps: apply.nextMap } });
  if (!isGameSyncActive()) return resolved;
  const uid = requireLocalParticipantUid();
  try {
    await patchGameState({ clutch: { taps: { [uid]: resolved } } });
    return resolved;
  } catch (err) {
    const live = getClutchSession();
    if (
      attemptId === clutchTapAttemptId &&
      canRollbackOptimisticSubmission(captured, live)
    ) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: live.taps,
        key: localName,
        hadPreviousValue: apply.hadPreviousValue,
        previousValue: apply.previousValue,
        optimisticValue: apply.optimisticValue,
        attemptId,
        currentAttemptId: clutchTapAttemptId,
      });
      if (rolled.applied) {
        saveStatePatch({ clutchGame: { ...live, taps: rolled.map } });
      }
    }
    console.warn("REVEAL clutch tap:", err);
    try {
      const { showAppAlert } = await import("./dialog.js");
      await showAppAlert(formatSyncErrorMessage(err?.message), {
        title: "Connexion",
        icon: "📡",
      });
    } catch {
      /* ignore UI */
    }
    throw err;
  }
}

export function __resetClutchTapAttemptIdForTests() {
  clutchTapAttemptId = 0;
}

export function hasLocalClutchTap(session = getClutchSession()) {
  const localName = getLocalDisplayName();
  return session.taps?.[localName]?.ms != null;
}

export function allClutchTapsIn(session = getClutchSession()) {
  return clutchAllTapsIn(session, session.taps || {}, {
    activeNames: getActivePlayerNames(),
    resolveNameByUserId: resolveLiveNameByUserId,
  });
}

export function getClutchEntryScreen() {
  const session = getClutchSession();
  if (!session.lobbyStarted) return "clutch-prep";
  return "clutch";
}

/**
 * Classe les joueurs par écart absolu à la cible (croissant). Les non-tappeurs sont
 * derniers (écart infini). Égalité d'écart départagée par le tap le plus tôt commit.
 * `playerNames` doit être le snapshot (getClutchParticipantNames) - pas le lobby live.
 */
export function rankClutchResults(
  taps = {},
  targetMs,
  playerNames = getClutchParticipantNames()
) {
  return rankClutchEntries(taps, targetMs, playerNames);
}
