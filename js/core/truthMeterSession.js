import {
  TRUTH_METER_AFFIRMATION_MIN,
  TRUTH_METER_AFFIRMATION_MAX,
  TRUTH_METER_MIN_PLAYERS,
} from "../../data/truthMeter.js";
import { checkHotTakeModeration } from "./hotTakeSession.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { addScore, bumpPlayerStat, getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  syncTruthMeterSession,
  allMembersReady,
  truthMeterToRemote,
  requireLocalParticipantUid,
  normalizePlayerVotesMap,
  applyRemoteSession,
  refreshGameSession,
  patchGameState,
} from "./gameSync.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { formatSyncErrorMessage } from "./authErrors.js";
import {
  computeTruthMeterVoteApply,
  compensateTruthMeterLocalVote,
  isTruthMeterVoteNetworkUncertainty,
  resolveConfirmedTruthMeterVote,
} from "./truthMeterVoteCommit.js";
import { createTruthMeterRunId } from "./truthMeterRunId.js";
import {
  mapTruthMeterRevealRpcError,
  mapTruthMeterVoteRpcError,
  validateTruthMeterRevealRequest,
  validateTruthMeterVoteRequest,
  isTruthMeterLateVoteError,
} from "./truthMeterRevealErrors.js";
import {
  evaluateTruthMeterRevealRecovery,
  evaluateTruthMeterVoteRecovery,
  isTruthMeterRevealBusinessError,
  isTruthMeterRevealNetworkError,
} from "./truthMeterRevealRecovery.js";
import { EVENING_POINTS } from "../../data/eveningScoring.js";
import {
  rpcRevealTruthMeterRound,
  rpcSubmitTruthMeterVote,
} from "./gameSessionRpc.js";

export {
  computeTruthMeterVoteApply,
  compensateTruthMeterLocalVote,
  resolveConfirmedTruthMeterVote,
} from "./truthMeterVoteCommit.js";

export {
  mapTruthMeterVoteRpcError,
  mapTruthMeterRevealRpcError,
  isTruthMeterLateVoteError,
  validateTruthMeterRevealRequest,
} from "./truthMeterRevealErrors.js";

/** @type {Set<string>} */
const appliedEveningRoundKeys = new Set();

function defaultSession() {
  return {
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
    matchScores: {},
    lastRound: null,
    runId: null,
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

export function defaultTruthMeterPrepSession() {
  return defaultSession();
}

export function getTruthMeterSession() {
  return getState().truthMeterGame || defaultSession();
}

export function isLocalTruthMeterHost() {
  return isLobbyHost();
}

export function truthLabel(pct) {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  if (n <= 15) return "Faux";
  if (n <= 40) return "Très douteux";
  if (n <= 55) return "Possible";
  if (n <= 80) return "Probable";
  return "Vrai";
}

export function getCurrentAuthor() {
  const session = getTruthMeterSession();
  const order = session.authorOrder || [];
  return order[session.roundIdx] || null;
}

export function getTruthMeterParticipantNames(session = getTruthMeterSession()) {
  if (session.authorOrder?.length) return session.authorOrder;
  return getActivePlayerNames();
}

export function getVoterNames() {
  const author = getCurrentAuthor();
  return getTruthMeterParticipantNames().filter((n) => n !== author);
}

/** Votes des juges uniquement - l'auteur ne participe pas au verdict du groupe. */
export function filterVoterVotes(votes = {}, author = getCurrentAuthor()) {
  const out = {};
  Object.entries(votes || {}).forEach(([name, v]) => {
    if (author && name === author) return;
    if (Number.isFinite(v)) out[name] = v;
  });
  return out;
}

export function computeGroupAverage(votes = {}, author = null) {
  const pool = author ? filterVoterVotes(votes, author) : votes;
  const values = Object.values(pool).filter((v) => Number.isFinite(v));
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function computeRoundMetrics(votes, authorEstimate, author = getCurrentAuthor()) {
  const voterVotes = filterVoterVotes(votes, author);
  const groupAvg = computeGroupAverage(voterVotes);
  const est = Number.isFinite(authorEstimate) ? authorEstimate : 0;
  const gap = Math.abs(est - groupAvg);
  const values = Object.values(voterVotes).filter((v) => Number.isFinite(v));
  let variance = 0;
  if (values.length > 1) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    variance = Math.round(
      values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
    );
  }
  return { groupAvg, gap, authorEstimate: est, variance };
}

export function validateAffirmation(text) {
  const trimmed = text.trim();
  if (trimmed.length < TRUTH_METER_AFFIRMATION_MIN) {
    return { ok: false, error: `Minimum ${TRUTH_METER_AFFIRMATION_MIN} caractères.` };
  }
  if (trimmed.length > TRUTH_METER_AFFIRMATION_MAX) {
    return { ok: false, error: `Maximum ${TRUTH_METER_AFFIRMATION_MAX} caractères.` };
  }
  const mod = checkHotTakeModeration(trimmed);
  if (mod.blocked) return { ok: false, error: mod.message };
  return { ok: true, text: trimmed };
}

export async function setTruthMeterReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getTruthMeterSession,
    saveLocal: (session) => saveStatePatch({ truthMeterGame: session }),
    stateKey: "truthMeter",
    gameId: "truthmeter",
    screen: "truthmeter-prep",
  });
}

export async function toggleLocalTruthMeterReady() {
  const name = getLocalDisplayName();
  const session = getTruthMeterSession();
  await setTruthMeterReady(name, !session.ready[name]);
}

export function allTruthMeterReady() {
  const session = getTruthMeterSession();
  if (isGameSyncActive()) {
    const remote = truthMeterToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export function simulateTruthMeterReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    setTruthMeterReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export async function markTruthMeterLobbyStarted({ rosterNames } = {}) {
  const names = rosterNames?.length ? rosterNames : getActivePlayerNames();
  if (names.length < TRUTH_METER_MIN_PLAYERS) {
    throw new Error(`Il faut au moins ${TRUTH_METER_MIN_PLAYERS} joueurs pour TruthMeter.`);
  }
  const next = {
    ...getTruthMeterSession(),
    lobbyStarted: true,
    authorOrder: shuffleArray(names),
    roundIdx: 0,
    phase: "writing",
    affirmation: null,
    authorEstimate: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
    matchScores: {},
    lastRound: null,
    runId: createTruthMeterRunId(),
  };
  // Nouvelle partie : autoriser à nouveau l'application soirée par manche
  appliedEveningRoundKeys.clear();
  return launchGameWithSync({
    screen: "truthmeter",
    gameId: "truthmeter",
    mode: "push",
    beforeCommit: async () => {
      if (isGameSyncActive() && isLobbyHost()) {
        const { setLobbyPlaying } = await import("./lobby.js");
        await setLobbyPlaying("truthmeter");
      }
    },
    applyLocal: () => saveStatePatch({ truthMeterGame: next }),
    getRemoteState: () => ({ truthMeter: truthMeterToRemote(next) }),
  });
}

export async function commitTruthMeterPlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "truthmeter",
    stateKey: "truthMeter",
    getSession: getTruthMeterSession,
    saveLocal: (session) => saveStatePatch({ truthMeterGame: session }),
    toRemote: truthMeterToRemote,
    patchOpts,
  });
}

/** Soumission affirmation auteur : hôte via commitHostGamePlay, invité via RPC dédiée. */
export async function commitTruthMeterAffirmation(text, authorEstimate) {
  const localName = getLocalDisplayName();
  const session = getTruthMeterSession();
  const patch = {
    roundIdx: session.roundIdx ?? 0,
    affirmation: { text, author: localName },
    authorEstimate,
    phase: "display",
    votes: {},
    roundScored: false,
  };
  if (isGameSyncActive() && isLobbyHost()) {
    return commitTruthMeterPlay(patch);
  }
  const next = { ...session, ...patch };
  saveStatePatch({ truthMeterGame: next });
  if (!isGameSyncActive()) return next;

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return next;
  const { rpcSubmitTruthMeterAffirmation } = await import("./gameSessionRpc.js");
  const { applyRemoteSession } = await import("./gameSync.js");
  const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
  const row = await rpcSubmitTruthMeterAffirmation({
    lobbyId,
    text,
    authorEstimate,
  });
  const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
  if (full) applyRemoteSession(full);
  return getTruthMeterSession();
}

/** Applique deltas lastRound → scores soirée + stats (hôte réel, une fois par manche). */
export function applyTruthMeterEveningFromLastRound(session = getTruthMeterSession()) {
  const lastRound = session?.lastRound;
  if (!lastRound?.deltas || typeof lastRound.deltas !== "object") return false;
  const key = `${session.runId || ""}:${session.roundIdx ?? 0}`;
  if (appliedEveningRoundKeys.has(key)) return false;
  appliedEveningRoundKeys.add(key);
  const author = session?.affirmation?.author || getCurrentAuthor();
  Object.entries(lastRound.deltas).forEach(([name, pts]) => {
    const n = Number(pts);
    if (!Number.isFinite(n) || n <= 0) return;
    addScore(name, n);
  });
  if (lastRound.bluffWin && author) {
    bumpPlayerStat(author, "truthMeterBluffWins", 1);
  }
  if (lastRound.voterPoints === EVENING_POINTS.BONUS) {
    Object.entries(lastRound.deltas).forEach(([name, pts]) => {
      if (author && name === author) return;
      if (Number(pts) > 0) bumpPlayerStat(name, "truthMeterMindReaderWins", 1);
    });
  }
  return true;
}

/** BUG-TRUTHMETER-01B — reveal atomique via RPC (MP uniquement). */
export async function commitTruthMeterReveal() {
  const session = getTruthMeterSession();
  if (!isGameSyncActive()) {
    throw new Error("commitTruthMeterReveal requires MP sync");
  }
  const req = validateTruthMeterRevealRequest(session);
  if (!req.ok) {
    throw mapTruthMeterRevealRpcError(new Error(req.code));
  }
  const lobbyId = getState().lobby.id;
  let networkError = null;
  try {
    const row = await rpcRevealTruthMeterRound({
      lobbyId,
      runId: req.runId,
      roundIdx: req.roundIdx,
    });
    if (row) applyRemoteSession(row);
    const synced = getTruthMeterSession();
    if (isLobbyHost() && synced.roundScored && synced.lastRound) {
      applyTruthMeterEveningFromLastRound(synced);
      try {
        await patchGameState(
          {},
          { gameId: "truthmeter", screen: "truthmeter", withEveningScores: true }
        );
      } catch (e) {
        console.warn("REVEAL truthMeter evening scores:", e);
      }
    }
    return synced;
  } catch (err) {
    const mapped = mapTruthMeterRevealRpcError(err);
    if (isTruthMeterRevealBusinessError(mapped)) {
      throw mapped;
    }
    if (!isTruthMeterRevealNetworkError(err) && !isTruthMeterRevealNetworkError(mapped)) {
      throw mapped;
    }
    networkError = mapped;
  }

  const freshRow = await refreshGameSession();
  if (freshRow) applyRemoteSession(freshRow);
  const recovery = evaluateTruthMeterRevealRecovery(freshRow?.state?.truthMeter, {
    runId: req.runId,
    roundIdx: req.roundIdx,
  });
  if (recovery.recovered) {
    const synced = getTruthMeterSession();
    if (isLobbyHost() && synced.roundScored && synced.lastRound) {
      applyTruthMeterEveningFromLastRound(synced);
    }
    return synced;
  }
  if (recovery.reason === "stale_run") {
    throw mapTruthMeterRevealRpcError(new Error("TRUTHMETER_STALE_RUN"));
  }
  if (recovery.reason === "stale_round") {
    throw mapTruthMeterRevealRpcError(new Error("TRUTHMETER_STALE_ROUND"));
  }
  throw networkError || new Error("Révélation impossible.");
}

/** MP : vote via submit_truth_meter_vote (FOR UPDATE + auto-reveal éventuel).
 * Rollback ciblé si échec ; recovery refresh si timeout/incertitude. */
export async function commitTruthMeterVote(choice) {
  const localName = getLocalDisplayName();
  const session = getTruthMeterSession();
  if (!Number.isFinite(choice)) {
    throw new Error("Vote invalide.");
  }

  const apply = computeTruthMeterVoteApply(session, localName, choice);
  saveStatePatch({
    truthMeterGame: { ...session, votes: apply.nextVotes },
  });

  if (!isGameSyncActive()) return choice;

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) {
    saveStatePatch({
      truthMeterGame: {
        ...getTruthMeterSession(),
        votes: compensateTruthMeterLocalVote(getTruthMeterSession(), localName, apply),
      },
    });
    throw new Error("Lobby introuvable.");
  }

  const voteReq = validateTruthMeterVoteRequest(session);
  if (!voteReq.ok) {
    saveStatePatch({
      truthMeterGame: {
        ...getTruthMeterSession(),
        votes: compensateTruthMeterLocalVote(getTruthMeterSession(), localName, apply),
      },
    });
    const mapped = mapTruthMeterVoteRpcError(new Error(voteReq.code));
    const { showAppAlert } = await import("./dialog.js");
    await showAppAlert(mapped.message, { title: "TruthMeter", icon: "📏" });
    throw mapped;
  }

  const localUid = requireLocalParticipantUid();
  let networkError = null;
  try {
    const row = await rpcSubmitTruthMeterVote({
      lobbyId,
      runId: voteReq.runId,
      roundIdx: voteReq.roundIdx,
      value: choice,
    });
    if (!row) throw new Error("Contribution refusée.");
    let full = row;
    if (!row.state) {
      full = (await refreshGameSession()) || row;
    }
    if (full) applyRemoteSession(full);
    const synced = getTruthMeterSession();
    const confirmed = resolveConfirmedTruthMeterVote(synced, localName);
    if (confirmed !== choice && synced.phase !== "reveal") {
      saveStatePatch({
        truthMeterGame: {
          ...getTruthMeterSession(),
          votes: {
            ...(getTruthMeterSession().votes || {}),
            [localName]: choice,
          },
        },
      });
    }
    if (isLobbyHost() && synced.phase === "reveal" && synced.roundScored && synced.lastRound) {
      applyTruthMeterEveningFromLastRound(synced);
    }
    return choice;
  } catch (err) {
    const mappedVote = mapTruthMeterVoteRpcError(err);
    if (isTruthMeterLateVoteError(mappedVote) || isTruthMeterRevealBusinessError(mappedVote)) {
      saveStatePatch({
        truthMeterGame: {
          ...getTruthMeterSession(),
          votes: compensateTruthMeterLocalVote(getTruthMeterSession(), localName, apply),
        },
      });
      try {
        const fresh = await refreshGameSession();
        if (fresh) applyRemoteSession(fresh);
      } catch {
        /* ignore */
      }
      console.warn("REVEAL truthMeter vote:", mappedVote);
      const { showAppAlert } = await import("./dialog.js");
      await showAppAlert(mappedVote.message, { title: "TruthMeter", icon: "📏" });
      throw mappedVote;
    }

    if (
      isTruthMeterVoteNetworkUncertainty(err) ||
      isTruthMeterRevealNetworkError(err) ||
      isTruthMeterRevealNetworkError(mappedVote)
    ) {
      try {
        const fresh = await refreshGameSession();
        if (fresh) applyRemoteSession(fresh);
        const remoteTm = fresh?.state?.truthMeter;
        const recovery = evaluateTruthMeterVoteRecovery(remoteTm, {
          runId: voteReq.runId,
          roundIdx: voteReq.roundIdx,
          choice,
          localUid,
        });
        if (recovery.recovered) {
          const confirmed = resolveConfirmedTruthMeterVote(
            getTruthMeterSession(),
            localName
          );
          if (confirmed === choice || getTruthMeterSession().phase === "reveal") {
            return choice;
          }
        }
      } catch {
        /* continue compensation */
      }
      networkError = mappedVote;
    } else {
      networkError = mappedVote;
    }

    const live = getTruthMeterSession();
    saveStatePatch({
      truthMeterGame: {
        ...live,
        votes: compensateTruthMeterLocalVote(live, localName, apply),
      },
    });

    console.warn("REVEAL truthMeter vote:", networkError || err);
    const { showAppAlert } = await import("./dialog.js");
    await showAppAlert(
      (networkError || mappedVote)?.message ||
        formatSyncErrorMessage(err?.message) ||
        "Impossible d'enregistrer ton vote. Réessaie.",
      { title: "TruthMeter", icon: "📏" }
    );
    throw networkError || mappedVote || err;
  }
}

export function allTruthMeterVotesIn(session = getTruthMeterSession()) {
  const voters = getVoterNames();
  if (!voters.length) return true;
  const votes = normalizePlayerVotesMap(session.votes || {}, voters);
  return voters.every((n) => votes[n] != null && Number.isFinite(votes[n]));
}

export function countTruthMeterVotes(session = getTruthMeterSession()) {
  const voters = getVoterNames();
  return Object.keys(normalizePlayerVotesMap(session.votes || {}, voters)).length;
}

export function getTruthMeterEntryScreen() {
  const session = getTruthMeterSession();
  if (!session.lobbyStarted) return "truthmeter-prep";
  return "truthmeter";
}

/** Votes NPC pour le mode local */
export async function finishTruthMeterGameSession() {
  const session = getTruthMeterSession();
  const total = (session.authorOrder || []).length;
  const { recordTruthMeterPlayed, setLastGame, setLobbyWaiting } = await import("./state.js");
  const { completeGameSession } = await import("./gameSync.js");
  const { navigate } = await import("./router.js");
  const lastRound = session.lastRound;

  recordTruthMeterPlayed();
  setLastGame({
    gameId: "truthmeter",
    title: "TruthMeter",
    summary: `${total} manches · dernier verdict ${lastRound?.groupAvg ?? "-"}%`,
  });
  if (isGameSyncActive()) {
    try {
      await completeGameSession({ gameId: "truthmeter", screen: "results", state: {} });
    } catch (e) {
      console.warn("REVEAL completeGameSession:", e);
      navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
    }
  } else {
    setLobbyWaiting();
  }
  navigate("results");
}

/** Hôte : passe la manche si l'auteur est absent (phase writing). */
export async function skipTruthMeterAuthorRound() {
  if (!isLobbyHost()) return { ok: false };
  const session = getTruthMeterSession();
  const order = session.authorOrder || [];
  const total = order.length;
  const nextIdx = (session.roundIdx ?? 0) + 1;

  if (nextIdx >= total) {
    await finishTruthMeterGameSession();
    return { ok: true, completed: true };
  }

  await commitTruthMeterPlay({
    roundIdx: nextIdx,
    phase: "writing",
    affirmation: null,
    authorEstimate: null,
    votes: {},
    voteEndsAt: null,
    roundScored: false,
  });
  return { ok: true, completed: false };
}

export function simulateTruthMeterVotes(localValue) {
  const author = getCurrentAuthor();
  const result = {};
  const local = getLocalDisplayName();
  getTruthMeterParticipantNames().forEach((name) => {
    if (name === author || name === local) return;
    const noise = Math.floor(Math.random() * 41) - 20;
    result[name] = Math.max(0, Math.min(100, localValue + noise));
  });
  if (local !== author) result[local] = localValue;
  return result;
}
