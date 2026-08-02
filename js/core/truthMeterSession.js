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
  canActAsHost,
  syncTruthMeterSession,
  allMembersReady,
  truthMeterToRemote,
  requireLocalParticipantUid,
  getLocalParticipantUid,
  normalizePlayerVotesMap,
  applyRemoteSession,
  refreshGameSession,
  nameForUserId,
} from "./gameSync.js";
import { getLobbyParticipants } from "./lobby.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { formatSyncErrorMessage } from "./authErrors.js";
import {
  computeTruthMeterVoteApply,
  compensateTruthMeterLocalVote,
  isTruthMeterVoteNetworkUncertainty,
  resolveConfirmedTruthMeterVote,
  countConfirmedVoterVotesInMap,
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
import {
  buildTruthMeterAuthorOrderUids,
  resolveTruthMeterAuthorUid,
  isLocalTruthMeterAuthor,
  getTruthMeterAuthorDisplayName,
  tm02Log,
} from "./truthMeterIdentity.js";

export {
  computeTruthMeterVoteApply,
  compensateTruthMeterLocalVote,
  resolveConfirmedTruthMeterVote,
  countConfirmedVoterVotesInMap,
  hydrateTruthMeterMatchScores,
  isTruthMeterRemoteScoreAuthority,
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

export function getCurrentTruthMeterAuthorUid(session = getTruthMeterSession()) {
  const roster = (getState().lobby?.participants || []).map((p) => ({
    userId: p.userId,
    name: p.name,
  }));
  return resolveTruthMeterAuthorUid(session, { roster });
}

/** Display name de l'auteur courant (cosmétique). Identité = getCurrentTruthMeterAuthorUid. */
export function getCurrentAuthor(session = getTruthMeterSession()) {
  const roster = (getState().lobby?.participants || []).map((p) => ({
    userId: p.userId,
    name: p.name,
  }));
  return getTruthMeterAuthorDisplayName(session, {
    roster,
    nameForUid: nameForUserId,
  });
}

export function isLocalTruthMeterAuthorNow(session = getTruthMeterSession()) {
  // Solo / offline : authorOrder reste name-keyed (pas de wire MP) — gate par pseudo local.
  if (!isGameSyncActive()) {
    const localName = getLocalDisplayName();
    const entry = (session.authorOrder || [])[session.roundIdx ?? 0];
    if (localName && entry != null && String(entry) === String(localName)) return true;
    if (localName && session.affirmation?.author === localName) return true;
    return false;
  }
  const localUid = getLocalParticipantUid();
  const roster = (getState().lobby?.participants || []).map((p) => ({
    userId: p.userId,
    name: p.name,
  }));
  return isLocalTruthMeterAuthor(session, localUid, { roster });
}

export function getTruthMeterParticipantNames(session = getTruthMeterSession()) {
  const order = session.authorOrder || [];
  if (!order.length) return getActivePlayerNames();
  // Order peut être UID ou legacy name — résoudre en labels d'affichage.
  return order.map((entry) => {
    const asName = nameForUserId(entry);
    if (asName) return asName;
    const rosterHit = (getState().lobby?.participants || []).find(
      (p) => p.name === entry || p.userId === entry
    );
    return rosterHit?.name || String(entry);
  });
}

export function getVoterNames(session = getTruthMeterSession()) {
  const authorUid = getCurrentTruthMeterAuthorUid(session).uid;
  const participants = getState().lobby?.participants || [];
  if (authorUid && participants.length) {
    return participants
      .filter((p) => p.userId && String(p.userId) !== String(authorUid))
      .map((p) => p.name)
      .filter(Boolean);
  }
  const author = getCurrentAuthor(session);
  return getTruthMeterParticipantNames(session).filter((n) => n !== author);
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
  // BUG-TRUTHMETER-02 : authorOrder = UIDs uniquement (plus getActivePlayerNames).
  let authorOrder;
  if (isGameSyncActive()) {
    const built = buildTruthMeterAuthorOrderUids(getLobbyParticipants());
    if (!built.ok) throw new Error(built.error);
    authorOrder = shuffleArray(built.uids);
  } else {
    // Solo / offline : pas d'UID lobby — conserver noms locaux (pas de wire MP).
    const names = rosterNames?.length ? rosterNames : getActivePlayerNames();
    if (names.length < TRUTH_METER_MIN_PLAYERS) {
      throw new Error(`Il faut au moins ${TRUTH_METER_MIN_PLAYERS} joueurs pour TruthMeter.`);
    }
    authorOrder = shuffleArray(names);
  }
  if (authorOrder.length < TRUTH_METER_MIN_PLAYERS) {
    throw new Error(`Il faut au moins ${TRUTH_METER_MIN_PLAYERS} joueurs pour TruthMeter.`);
  }
  const next = {
    ...getTruthMeterSession(),
    lobbyStarted: true,
    authorOrder,
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
  const localUid = isGameSyncActive()
    ? requireLocalParticipantUid()
    : getLocalParticipantUid() || localName;
  const session = getTruthMeterSession();
  const expected = getCurrentTruthMeterAuthorUid(session);
  if (isGameSyncActive()) {
    if (expected.unresolved || !expected.uid) {
      tm02Log("legacy-author-unresolved", {
        runId: session.runId,
        phase: session.phase,
        roundIdx: session.roundIdx,
        reason: expected.reason,
        legacyValue: expected.legacyValue || null,
      });
      throw new Error("Auteur du round indéterminé. Recharge ou passe cet auteur.");
    }
    if (String(expected.uid) !== String(localUid)) {
      throw new Error("Seul l'auteur du round peut soumettre l'affirmation.");
    }
  }
  const patch = {
    roundIdx: session.roundIdx ?? 0,
    affirmation: {
      text,
      authorUid: localUid || undefined,
      author: localName,
    },
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
      // Soirée : cumul local idempotent. Pas de patchGameState evening ici —
      // un RMW hôte post-reveal peut réécrire un blob stale et diverger des invités.
      applyTruthMeterEveningFromLastRound(synced);
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

/**
 * Compteur hôte « Révéler maintenant X/Y » — votes confirmés session uniquement
 * (pas de draft / pending / in-flight).
 */
export function countConfirmedTruthMeterVoterVotes(
  session = getTruthMeterSession(),
  voterNames = getVoterNames()
) {
  const names = voterNames.length ? voterNames : getTruthMeterParticipantNames(session);
  const votes = normalizePlayerVotesMap(session?.votes || {}, names);
  return countConfirmedVoterVotesInMap(votes, names);
}

export function countTruthMeterVotes(session = getTruthMeterSession()) {
  return countConfirmedTruthMeterVoterVotes(session);
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

/** Hôte / acting host : passe la manche si l'auteur est absent ou irrésoluble (phase writing). */
export async function skipTruthMeterAuthorRound() {
  // Aligné UI (canActAsHost) + commitHostGamePlay — pas isLobbyHost seul.
  if (!canActAsHost()) return { ok: false, reason: "not-acting-host" };
  const session = getTruthMeterSession();
  if (session.phase !== "writing") {
    return { ok: false, reason: "wrong-phase" };
  }
  const order = session.authorOrder || [];
  const total = order.length;
  const nextIdx = (session.roundIdx ?? 0) + 1;
  // runId inchangé : commitTruthMeterPlay ne remplace pas runId (même run, curseur +1).

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
