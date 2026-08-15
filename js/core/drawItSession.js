import {
  DRAW_IT_CATALOG_ID,
  DRAW_IT_CATEGORIES,
  DRAW_IT_ROUND_PRESETS,
  DRAW_IT_ROUND_ALL,
  DRAW_IT_ROUND_DURATION_MS,
  DRAW_IT_WORDS,
  getDrawItCategoryWords,
  isDrawItCategoryId,
  isDrawItRoundCount,
} from "../../data/drawIt.js";
import { getActivePlayerNames } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import {
  addScore,
  getCurrentSessionScoreMap,
  getLocalDisplayName,
  getState,
  recordEveningGameOnce,
  saveStatePatch,
  setActiveScoringGame,
} from "./state.js";
import {
  isLobbyHost,
  isGameSyncActive,
  canActAsHost,
  syncDrawItSession,
  allMembersReady,
  drawItToRemote,
  applyRemoteSession,
  refreshGameSession,
  completeGameSession,
} from "./gameSync.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { shuffleArray, dedupeEntriesById } from "./combinedGameDeck.js";
import { estimateDrawItDuration } from "./drawItDuration.js";
import { createDrawItRunId } from "./drawItRunId.js";
import { buildClutchParticipantsSnapshot } from "./clutchParticipants.js";
import { createActionLock } from "./actionLock.js";
import { isSupabaseConfigured } from "./supabaseClient.js";
import {
  applyDrawItNextRound,
  applyDrawItReveal,
  buildDrawItDrawerOrder,
  buildDrawItLaunchState,
  canCommitDrawItNextRound,
  canCommitDrawItReveal,
  canCompleteDrawItGame,
  drawerUidForRound,
} from "./drawItRound.js";
import {
  fetchMyDrawItPrivate,
  hostLaunchDrawItGame,
  hostWriteDrawItPrivateRounds,
  peekLocalDrawItPrivate,
} from "./drawItPrivate.js";
import {
  applyDrawItGuess,
  canSubmitDrawItGuess,
  isDrawItGuessInputLocked,
} from "./drawItGuesses.js";
import { getSupabaseUserId } from "./supabaseAuth.js";

function defaultSession() {
  return {
    ready: {},
    lobbyStarted: false,
    selectedCategoryId: DRAW_IT_CATALOG_ID,
    roundCount: 5,
  };
}

export function getDrawItSession() {
  return getState().drawItGame || defaultSession();
}

export function defaultDrawItPrepSession() {
  return defaultSession();
}

export function getDrawItRoundCount() {
  return getDrawItSession().roundCount ?? 5;
}

export function getDrawItPoolSize(categoryId = getDrawItSession().selectedCategoryId, words) {
  return distinctDrawItPool(categoryId, words).length;
}

function distinctDrawItPool(categoryId, words = DRAW_IT_WORDS) {
  return dedupeEntriesById(getDrawItCategoryWords(categoryId, words));
}

/**
 * Validation prépa (catégorie + presets 3/5/8 + pool).
 * Ne mute pas le catalogue. Ne construit pas de série publique.
 */
export function validateDrawItPrep(
  { selectedCategoryId, roundCount } = {},
  words = DRAW_IT_WORDS
) {
  const required = Number(roundCount);
  if (!isDrawItCategoryId(selectedCategoryId)) {
    return {
      valid: false,
      reason: "invalid_category",
      poolSize: 0,
      required: Number.isFinite(required) ? required : 0,
    };
  }
  const poolSize = distinctDrawItPool(selectedCategoryId, words).length;
  if (!isDrawItRoundCount(roundCount)) {
    return {
      valid: false,
      reason: "invalid_round_count",
      poolSize,
      required: Number.isFinite(required) ? required : 0,
    };
  }
  if (poolSize < required) {
    return {
      valid: false,
      reason: "insufficient_pool",
      poolSize,
      required,
    };
  }
  return { valid: true, poolSize, required };
}

/**
 * Série locale mélangée (copie). Jamais écrite dans drawItGame / game_sessions.
 * @returns {object[]}
 */
export function buildDrawItSeries(
  { selectedCategoryId, roundCount } = {},
  words = DRAW_IT_WORDS,
  random = Math.random
) {
  const check = validateDrawItPrep({ selectedCategoryId, roundCount }, words);
  if (!check.valid) return [];
  const pool = distinctDrawItPool(selectedCategoryId, words);
  return shuffleArray(pool, random).slice(0, check.required);
}

export function drawItPrepBlockLabel(check) {
  if (!check || check.valid) return "";
  if (check.reason === "insufficient_pool") {
    return `Pas assez de mots (${check.poolSize} / ${check.required})`;
  }
  if (check.reason === "invalid_round_count") {
    return "Choisis 3, 5 ou 8 manches";
  }
  if (check.reason === "invalid_category") {
    return "Catégorie invalide";
  }
  return "Configuration invalide";
}

export async function setDrawItCategory(categoryId) {
  const session = getDrawItSession();
  await syncDrawItSession({
    ...session,
    selectedCategoryId: categoryId || DRAW_IT_CATALOG_ID,
  });
}

export async function setDrawItRoundCount(count) {
  const session = getDrawItSession();
  await syncDrawItSession({
    ...session,
    roundCount: count,
  });
}

export function getDrawItPrepSummary() {
  const session = getDrawItSession();
  const selectedCategoryId = session.selectedCategoryId || DRAW_IT_CATALOG_ID;
  const requested = getDrawItRoundCount();
  const check = validateDrawItPrep({ selectedCategoryId, roundCount: requested });
  const duration = isDrawItRoundCount(requested)
    ? estimateDrawItDuration(requested)
    : estimateDrawItDuration(0);
  return {
    poolSize: check.poolSize,
    requested,
    required: check.required,
    effective: check.valid ? requested : 0,
    durationLabel: duration.label,
    durationMinSec: duration.minSec,
    valid: check.valid,
    reason: check.reason || null,
    blockLabel: drawItPrepBlockLabel(check),
    capped: false,
  };
}

const revealLock = createActionLock();
const nextRoundLock = createActionLock();
const completeLock = createActionLock();
const guessLock = createActionLock();

function freezeDrawItParticipants(rosterNames) {
  const lobby = getLobbyParticipants();
  const names =
    Array.isArray(rosterNames) && rosterNames.length
      ? rosterNames
      : getActivePlayerNames();
  return buildClutchParticipantsSnapshot(names, lobby).filter((p) => p.userId);
}

export async function markDrawItLobbyStarted({ rosterNames } = {}) {
  const session = getDrawItSession();
  const check = validateDrawItPrep({
    selectedCategoryId: session.selectedCategoryId,
    roundCount: session.roundCount,
  });
  if (!check.valid) return null;

  const participants = freezeDrawItParticipants(rosterNames);
  const drawerOrder = buildDrawItDrawerOrder(participants);
  if (!drawerOrder.length) return null;

  const series = buildDrawItSeries({
    selectedCategoryId: session.selectedCategoryId,
    roundCount: session.roundCount,
  });
  if (series.length < Number(session.roundCount)) return null;

  const runId = createDrawItRunId();
  const next = buildDrawItLaunchState({
    session,
    participants,
    nowMs: Date.now(),
    runId,
  });
  const rounds = series.map((word, i) => ({
    roundIdx: i,
    drawerUid: drawerUidForRound(drawerOrder, i),
    wordLabel: word.label,
    acceptedAnswers: Array.isArray(word.acceptedAnswers)
      ? word.acceptedAnswers
      : [word.label],
  }));

  if (isGameSyncActive() && isSupabaseConfigured()) {
    const launched = await hostLaunchDrawItGame({
      publicSession: drawItToRemote(next),
      runId,
      rounds,
    });
    if (!launched.ok || !launched.row?.state) {
      try {
        const { showAppAlert } = await import("./dialog.js");
        await showAppAlert(
          launched.error || "Impossible de lancer Draw it !",
          { title: "Connexion", icon: "📡" }
        );
      } catch {
        /* alerte optionnelle */
      }
      return { ok: false, error: launched.error || "launch_failed" };
    }
    applyRemoteSession(launched.row);
    return { ok: true };
  }

  await hostWriteDrawItPrivateRounds({ runId, rounds });

  return launchGameWithSync({
    screen: "drawit",
    gameId: "drawit",
    mode: "push",
    applyLocal: () => saveStatePatch({ drawItGame: next }),
    getRemoteState: () => ({ drawIt: drawItToRemote(next) }),
  });
}

async function commitDrawItPlay(patch) {
  return commitHostGamePlay({
    patch,
    gameId: "drawit",
    screen: "drawit",
    stateKey: "drawIt",
    getSession: getDrawItSession,
    saveLocal: (session) => saveStatePatch({ drawItGame: session }),
    toRemote: drawItToRemote,
  });
}

function resolveRevealWordLabel(session) {
  const lobbyId = getState().lobby?.id;
  const peeked = peekLocalDrawItPrivate(lobbyId, session.runId, session.roundIdx);
  return peeked?.wordLabel || "";
}

export async function commitDrawItReveal({ nowMs = Date.now() } = {}) {
  const outcome = await revealLock.run(async () => {
    const session = getDrawItSession();
    const check = canCommitDrawItReveal(session, nowMs);
    if (!check.ok) return { ok: false, reason: check.reason };

    if (isGameSyncActive() && isSupabaseConfigured() && canActAsHost()) {
      const { rpcRevealDrawItRound } = await import("./gameSessionRpc.js");
      const row = await rpcRevealDrawItRound({ lobbyId: getState().lobby.id });
      let full = row;
      if (row && !row.state) full = await refreshGameSession();
      if (!full?.state) return { ok: false, reason: "not_applied" };
      applyRemoteSession(full);
      if (getDrawItSession().phase !== "reveal") {
        return { ok: false, reason: "not_applied" };
      }
      return { ok: true, reason: null };
    }

    const applied = applyDrawItReveal(session, {
      wordLabel: resolveRevealWordLabel(session),
      nowMs,
    });
    if (!applied.ok) return applied;
    await commitDrawItPlay({
      phase: applied.session.phase,
      roundScored: applied.session.roundScored,
      lastRound: applied.session.lastRound,
    });
    return { ok: true, reason: null };
  });
  if (!outcome.ok && outcome.skipped) return { ok: false, reason: "in_flight" };
  return outcome.value;
}

export async function commitDrawItNextRound({ nowMs = Date.now() } = {}) {
  const outcome = await nextRoundLock.run(async () => {
    const session = getDrawItSession();
    const check = canCommitDrawItNextRound(session);
    if (!check.ok) return { ok: false, reason: check.reason };

    if (isGameSyncActive() && isSupabaseConfigured() && canActAsHost()) {
      const { rpcAdvanceDrawItRound } = await import("./gameSessionRpc.js");
      const row = await rpcAdvanceDrawItRound({ lobbyId: getState().lobby.id });
      let full = row;
      if (row && !row.state) full = await refreshGameSession();
      if (!full?.state) return { ok: false, reason: "not_applied" };
      applyRemoteSession(full);
      const synced = getDrawItSession();
      if (
        synced.phase !== "drawing" ||
        Number(synced.roundIdx) !== Number(check.nextIdx)
      ) {
        return { ok: false, reason: "not_applied" };
      }
      return { ok: true, reason: null };
    }

    const applied = applyDrawItNextRound(session, { nowMs });
    if (!applied.ok) return applied;
    await commitDrawItPlay({
      roundIdx: applied.session.roundIdx,
      phase: applied.session.phase,
      drawerUid: applied.session.drawerUid,
      roundStartAt: applied.session.roundStartAt,
      roundEndsAt: applied.session.roundEndsAt,
      roundScored: applied.session.roundScored,
      foundOrder: applied.session.foundOrder,
      guesses: applied.session.guesses,
      strokes: applied.session.strokes,
      canvasEpoch: applied.session.canvasEpoch,
      strokeSeq: applied.session.strokeSeq,
    });
    return { ok: true, reason: null };
  });
  if (!outcome.ok && outcome.skipped) return { ok: false, reason: "in_flight" };
  return outcome.value;
}

export async function commitDrawItComplete() {
  const outcome = await completeLock.run(async () => {
    let session = getDrawItSession();
    const check = canCompleteDrawItGame(session);
    if (!check.ok) return { ok: false, reason: check.reason };

    if (isGameSyncActive() && isSupabaseConfigured()) {
      const { rpcFinalizeDrawItScores } = await import("./gameSessionRpc.js");
      const scoredRow = await rpcFinalizeDrawItScores({
        lobbyId: getState().lobby.id,
      });
      if (!scoredRow?.state) return { ok: false, reason: "scores_not_committed" };
      applyRemoteSession(scoredRow);
      session = getDrawItSession();
      if (session.scoresCommittedRunId !== session.runId) {
        return { ok: false, reason: "scores_not_committed" };
      }
      await completeGameSession({ gameId: "drawit", screen: "results", state: {} });
      return { ok: true, reason: null };
    }

    commitDrawItMatchScoresLocal(session);
    if (isGameSyncActive()) {
      await completeGameSession({ gameId: "drawit", screen: "results", state: {} });
      return { ok: true, reason: null };
    }
    saveStatePatch({
      drawItGame: {
        ...session,
        lobbyStarted: false,
        scoresCommittedRunId: session.runId,
      },
    });
    return { ok: true, reason: null };
  });
  if (!outcome.ok && outcome.skipped) return { ok: false, reason: "in_flight" };
  return outcome.value;
}

/** Offline/fallback : converge le cumul du match vers les scores REVEAL sans double crédit. */
export function commitDrawItMatchScoresLocal(session = getDrawItSession()) {
  const current = getDrawItSession();
  if (
    session.runId &&
    current.runId === session.runId &&
    current.scoresCommittedRunId === session.runId
  ) {
    return getCurrentSessionScoreMap("drawit");
  }
  setActiveScoringGame("drawit");
  for (const [name, totalValue] of Object.entries(session.matchScores || {})) {
    const total = Number(totalValue) || 0;
    if (total > 0) addScore(name, total);
  }
  recordEveningGameOnce("drawit", () => {});
  saveStatePatch({
    drawItGame: {
      ...session,
      scoresCommittedRunId: session.runId || null,
    },
  });
  return getCurrentSessionScoreMap("drawit");
}

/**
 * Proposition de mot. MP : RPC atomique (FOR UPDATE). Hors-ligne : apply local.
 * Pas d'optimistic foundOrder — le serveur (ou apply) confirme.
 */
export async function submitDrawItGuess(rawValue, { nowMs = Date.now(), uid } = {}) {
  const outcome = await guessLock.run(async () => {
    const session = getDrawItSession();
    const author = uid || getSupabaseUserId();
    const check = canSubmitDrawItGuess(session, { uid: author, nowMs });
    if (!check.ok) return { ok: false, reason: check.reason };

    if (isGameSyncActive() && isSupabaseConfigured()) {
      const { rpcSubmitDrawItGuess } = await import("./gameSessionRpc.js");
      try {
        const row = await rpcSubmitDrawItGuess({
          lobbyId: getState().lobby.id,
          runId: session.runId,
          roundIdx: session.roundIdx,
          value: rawValue,
        });
        if (!row) throw new Error("Proposition refusée.");
        let full = row;
        if (!row.state) {
          full = (await refreshGameSession()) || row;
        }
        if (full) applyRemoteSession(full);
        const synced = getDrawItSession();
        const trimmed = String(rawValue ?? "").trim();
        const last = Array.isArray(synced.guesses)
          ? synced.guesses[synced.guesses.length - 1]
          : null;
        if (
          !last ||
          String(last.uid) !== String(author) ||
          (!last.correct && last.value !== trimmed)
        ) {
          return { ok: false, reason: "not_applied" };
        }
        return { ok: true, correct: Boolean(last.correct), reason: null };
      } catch (error) {
        const message = String(error?.message || error || "");
        const code = message.match(/DRAWIT_[A-Z_]+/)?.[0] || "rpc_failed";
        try {
          const { showAppAlert } = await import("./dialog.js");
          const { formatSyncErrorMessage } = await import("./authErrors.js");
          await showAppAlert(
            formatSyncErrorMessage(message) || "Proposition non enregistrée.",
            { title: "Draw it !", icon: "✏️" }
          );
        } catch {
          /* alerte optionnelle */
        }
        return { ok: false, reason: code.toLowerCase() };
      }
    }

    const lobbyId = getState().lobby?.id;
    const priv = peekLocalDrawItPrivate(lobbyId, session.runId, session.roundIdx);
    const applied = applyDrawItGuess(session, {
      uid: author,
      value: rawValue,
      nowMs,
      serverAt: new Date(nowMs).toISOString(),
      wordLabel: priv?.wordLabel || "",
      acceptedAnswers: priv?.acceptedAnswers || [],
    });
    if (!applied.ok) return applied;
    let nextSession = applied.session;
    if (applied.correct) {
      const revealed = applyDrawItReveal(nextSession, {
        wordLabel: priv?.wordLabel || "",
        nowMs,
      });
      if (revealed.ok) nextSession = revealed.session;
    }
    saveStatePatch({ drawItGame: nextSession });
    return { ok: true, correct: applied.correct, reason: null };
  });
  if (!outcome.ok && outcome.skipped) return { ok: false, reason: "in_flight" };
  return outcome.value;
}

export async function loadLocalDrawItPrivateWord() {
  const session = getDrawItSession();
  if (session.phase !== "drawing") return null;
  return fetchMyDrawItPrivate(session.runId, session.roundIdx);
}

export async function setDrawItReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getDrawItSession,
    saveLocal: (session) => saveStatePatch({ drawItGame: session }),
    stateKey: "drawIt",
    gameId: "drawit",
    screen: "drawit-prep",
  });
}

export function allDrawItReady() {
  const session = getDrawItSession();
  if (isGameSyncActive()) {
    const remote = drawItToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export function simulateDrawItReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    setDrawItReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export function getDrawItEntryScreen() {
  const session = getDrawItSession();
  if (!session.lobbyStarted) return "drawit-prep";
  return "drawit";
}

export function isLocalDrawItHost() {
  return isLobbyHost();
}

export {
  DRAW_IT_CATEGORIES,
  DRAW_IT_ROUND_PRESETS,
  DRAW_IT_ROUND_ALL,
  DRAW_IT_CATALOG_ID,
  DRAW_IT_ROUND_DURATION_MS,
  isDrawItCategoryId,
  isDrawItRoundCount,
  drawItToRemote,
  canCommitDrawItReveal,
  canCommitDrawItNextRound,
  canCompleteDrawItGame,
  applyDrawItReveal,
  applyDrawItNextRound,
  buildDrawItDrawerOrder,
  drawerUidForRound,
  buildDrawItLaunchState,
  canSubmitDrawItGuess,
  isDrawItGuessInputLocked,
  applyDrawItGuess,
};
