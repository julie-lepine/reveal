import {
  RACE_TO_ZERO_GRACE_MS,
  pickRaceToZeroTarget,
} from "../../data/raceToZero.js";
import { getActivePlayerNames } from "./players.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  syncRaceToZeroSession,
  allMembersReady,
  raceToZeroToRemote,
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

export function getRaceToZeroSession() {
  return getState().raceToZeroGame || defaultSession();
}

export function defaultRaceToZeroPrepSession() {
  return defaultSession();
}

export function getRaceToZeroRoundCount() {
  return getRaceToZeroSession().roundCount ?? 5;
}

export async function setRaceToZeroRoundCount(count) {
  const session = getRaceToZeroSession();
  await syncRaceToZeroSession({ ...session, roundCount: count });
}

export function getRaceToZeroPrepSummary() {
  const requested = getRaceToZeroRoundCount();
  return {
    requested,
    effective: requested,
    durationLabel: `${requested} manche${requested > 1 ? "s" : ""}`,
  };
}

/** Charge utile d'une nouvelle manche : cible aléatoire + fenêtre de clôture (cible + grâce). */
function roundPayload(roundIdx) {
  const targetMs = pickRaceToZeroTarget();
  const startAt = Date.now();
  return {
    roundIdx,
    phase: "active",
    targetMs,
    roundStartAt: new Date(startAt).toISOString(),
    roundEndsAt: new Date(startAt + targetMs + RACE_TO_ZERO_GRACE_MS).toISOString(),
    taps: {},
    roundScored: false,
    lastRound: null,
  };
}

export async function markRaceToZeroLobbyStarted() {
  const next = {
    ...getRaceToZeroSession(),
    lobbyStarted: true,
    ...roundPayload(0),
  };
  return launchGameWithSync({
    screen: "racetozero",
    gameId: "racetozero",
    mode: "push",
    applyLocal: () => saveStatePatch({ raceToZeroGame: next }),
    getRemoteState: () => ({ raceToZero: raceToZeroToRemote(next) }),
  });
}

export async function startRaceToZeroRound(roundIdx) {
  const next = {
    ...getRaceToZeroSession(),
    ...roundPayload(roundIdx),
  };
  await syncRaceToZeroSession(next);
  return next;
}

export async function commitRaceToZeroPlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "racetozero",
    stateKey: "raceToZero",
    getSession: getRaceToZeroSession,
    saveLocal: (session) => saveStatePatch({ raceToZeroGame: session }),
    toRemote: raceToZeroToRemote,
    patchOpts,
  });
}

export async function setRaceToZeroReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getRaceToZeroSession,
    saveLocal: (session) => saveStatePatch({ raceToZeroGame: session }),
    stateKey: "raceToZero",
    gameId: "racetozero",
    screen: "racetozero-prep",
  });
}

export function allRaceToZeroReady() {
  const session = getRaceToZeroSession();
  if (isGameSyncActive()) {
    const remote = raceToZeroToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

/** MP : envoie uniquement le tap local ({ ms, at }). Premier tap conservé. */
export async function commitRaceToZeroTap(ms) {
  const localName = getLocalDisplayName();
  const session = getRaceToZeroSession();
  if (session.taps?.[localName]?.ms != null) {
    return session.taps[localName];
  }
  const tap = { ms, at: Date.now() };
  const taps = { ...(session.taps || {}), [localName]: tap };
  saveStatePatch({ raceToZeroGame: { ...session, taps } });
  if (!isGameSyncActive()) return tap;
  const uid = userIdForName(localName) || localName;
  await patchGameStateWithFeedback({ raceToZero: { taps: { [uid]: tap } } });
  return tap;
}

export function hasLocalRaceToZeroTap(session = getRaceToZeroSession()) {
  const localName = getLocalDisplayName();
  return session.taps?.[localName]?.ms != null;
}

export function allRaceToZeroTapsIn(session = getRaceToZeroSession()) {
  const names = getActivePlayerNames();
  const taps = session.taps || {};
  return names.length > 0 && names.every((n) => taps[n]?.ms != null);
}

export function getRaceToZeroEntryScreen() {
  const session = getRaceToZeroSession();
  if (!session.lobbyStarted) return "racetozero-prep";
  return "racetozero";
}

/**
 * Classe les joueurs par écart absolu au 0 (croissant). Les non-tappeurs sont
 * derniers (écart infini). Égalité d'écart départagée par le tap le plus tôt commit.
 */
export function rankRaceToZeroResults(taps = {}, targetMs, playerNames = getActivePlayerNames()) {
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
