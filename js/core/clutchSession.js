import {
  CLUTCH_GRACE_MS,
  pickClutchTarget,
} from "../../data/clutch.js";
import { getActivePlayerNames } from "./players.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  syncClutchSession,
  allMembersReady,
  clutchToRemote,
  userIdForName,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";

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
  return {
    requested,
    effective: requested,
    durationLabel: `${requested} manche${requested > 1 ? "s" : ""}`,
  };
}

/** Charge utile d'une nouvelle manche : cible aléatoire + fenêtre de clôture (cible + grâce). */
function roundPayload(roundIdx) {
  const targetMs = pickClutchTarget();
  const startAt = Date.now();
  return {
    roundIdx,
    phase: "active",
    targetMs,
    roundStartAt: new Date(startAt).toISOString(),
    roundEndsAt: new Date(startAt + targetMs + CLUTCH_GRACE_MS).toISOString(),
    taps: {},
    roundScored: false,
    lastRound: null,
  };
}

export async function markClutchLobbyStarted() {
  const next = {
    ...getClutchSession(),
    lobbyStarted: true,
    ...roundPayload(0),
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

/** MP : envoie uniquement le tap local ({ ms, at }). Premier tap conservé. */
export async function commitClutchTap(ms) {
  const localName = getLocalDisplayName();
  const session = getClutchSession();
  if (session.taps?.[localName]?.ms != null) {
    return session.taps[localName];
  }
  const tap = { ms, at: Date.now() };
  const taps = { ...(session.taps || {}), [localName]: tap };
  saveStatePatch({ clutchGame: { ...session, taps } });
  if (!isGameSyncActive()) return tap;
  const uid = userIdForName(localName) || localName;
  await patchGameStateWithFeedback({ clutch: { taps: { [uid]: tap } } });
  return tap;
}

export function hasLocalClutchTap(session = getClutchSession()) {
  const localName = getLocalDisplayName();
  return session.taps?.[localName]?.ms != null;
}

export function allClutchTapsIn(session = getClutchSession()) {
  const names = getActivePlayerNames();
  const taps = session.taps || {};
  return names.length > 0 && names.every((n) => taps[n]?.ms != null);
}

export function getClutchEntryScreen() {
  const session = getClutchSession();
  if (!session.lobbyStarted) return "clutch-prep";
  return "clutch";
}

/**
 * Classe les joueurs par écart absolu à la cible (croissant). Les non-tappeurs sont
 * derniers (écart infini). Égalité d'écart départagée par le tap le plus tôt commit.
 */
export function rankClutchResults(taps = {}, targetMs, playerNames = getActivePlayerNames()) {
  const entries = playerNames.map((name) => {
    const t = taps[name];
    const tapped = t && typeof t.ms === "number" && Number.isFinite(t.ms);
    const ms = tapped ? t.ms : null;
    const gap = tapped ? Math.abs(ms - targetMs) : Infinity;
    const at = t && typeof t.at === "number" ? t.at : Infinity;
    return { name, ms, gap, tapped, at };
  });
  entries.sort((a, b) => {
    if (a.gap !== b.gap) return a.gap - b.gap;
    return a.at - b.at;
  });
  return entries;
}
