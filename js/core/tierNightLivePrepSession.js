/**
 * FEATURE-TIERNIGHT-04D / 04E - session prep Rank Live (`tierNightLiveSeriesPrep` /
 * remote `tierNightLivePrep`).
 *
 * Shell prep partagé ; domaine live distinct du roster.
 * Launch série = RPC atomique 04E (pas de stub ; pas de mono).
 */
import {
  getState,
  saveStatePatch,
  getLocalDisplayName,
} from "./state.js";
import {
  TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS,
  DEFAULT_TIER_NIGHT_LIVE_SERIES_ROUND_COUNT,
  TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES,
  isValidTierNightLiveRoundCount,
  getTierNightLiveOfficialPool,
  normalizeTierNightLivePrepCategoryIds,
  validateTierNightLiveSeriesCategoryIds,
  getTierNightLivePoolSize,
  getTierNightLiveRoundCountAvailability,
  formatTierNightLiveCategorySummary,
} from "./tierNightLiveSeriesDomain.js";
import { estimateTierNightSeriesDuration } from "./tierNightSeriesDuration.js";
import {
  buildTierNightLiveSeriesLaunchState,
  mapTierNightLiveLaunchError,
  extractTierNightLiveLaunchCode,
  obtainTierNightLiveLaunchAttempt,
  clearInFlightTierNightLiveLaunchAttempt,
} from "./tierNightLiveSeriesLaunch.js";
import {
  isGameSyncActive,
  isLobbyHost,
  allMembersReady,
  patchGameState,
  tierNightPrepToRemote,
  tierNightPrepFromRemote,
  applyRemoteSession,
  refreshGameSession,
  getCachedGameSession,
} from "./gameSync.js";
import { commitPrepReadyToggle } from "./mpLaunch.js";
import { getActivePlayerNames } from "./players.js";
import { navigate } from "./router.js";
import {
  addCustomLiveTierListAndSync,
  deleteCustomLiveTierListAndSync,
  listCustomLiveTierLists,
} from "./customLiveTierListSession.js";
import { isCustomLiveTierListOwnedBy } from "./sessionMerge.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getHotTakeModerationNotice } from "./hotTakeModeration.js";
import { setLobbyPlaying, getLobbyParticipants } from "./lobby.js";
import { rpcStartTierNightLiveSeries } from "./gameSessionRpc.js";
import { buildTierNightPlayerRoster } from "./tierNightRoster.js";

export const getModerationNotice = getHotTakeModerationNotice;

export const TIER_NIGHT_LIVE_PREP_DEFAULT_ROUND_COUNT =
  DEFAULT_TIER_NIGHT_LIVE_SERIES_ROUND_COUNT;

/** @deprecated 04E - plus de stub ; conservé pour tests source anti-régression legacy. */
export const TNS_LIVE_LAUNCH_PENDING_04E = "TNS_LIVE_LAUNCH_PENDING_04E";

function defaultLivePrepSession() {
  return {
    categoryIds: [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES],
    roundCount: TIER_NIGHT_LIVE_PREP_DEFAULT_ROUND_COUNT,
    ready: {},
    setupEpoch: 0,
    poolInvalidateRequestId: null,
  };
}

function livePrepPoolOpts() {
  return { customLists: listCustomLiveTierLists() };
}

function categoryIdsEqual(a, b) {
  const aa = Array.isArray(a) ? a.map(String) : [];
  const bb = Array.isArray(b) ? b.map(String) : [];
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

export function getTierNightLivePrepSession() {
  const raw = getState().tierNightLiveSeriesPrep;
  if (!raw || typeof raw !== "object") return defaultLivePrepSession();
  const roundRaw = raw.roundCount;
  const roundCount =
    roundRaw == null || roundRaw === ""
      ? TIER_NIGHT_LIVE_PREP_DEFAULT_ROUND_COUNT
      : isValidTierNightLiveRoundCount(Number(roundRaw))
        ? Number(roundRaw)
        : TIER_NIGHT_LIVE_PREP_DEFAULT_ROUND_COUNT;
  return {
    categoryIds: normalizeTierNightLivePrepCategoryIds(raw.categoryIds),
    roundCount,
    ready: raw.ready && typeof raw.ready === "object" ? { ...raw.ready } : {},
    setupEpoch: Number(raw.setupEpoch) || 0,
    poolInvalidateRequestId: raw.poolInvalidateRequestId
      ? String(raw.poolInvalidateRequestId)
      : null,
  };
}

export function tierNightLivePrepToRemote(session = getTierNightLivePrepSession()) {
  return tierNightPrepToRemote({
    ...session,
    categoryIds: normalizeTierNightLivePrepCategoryIds(session.categoryIds),
  });
}

export function tierNightLivePrepFromRemote(remote) {
  const base = tierNightPrepFromRemote(remote);
  const roundRaw = base.roundCount;
  return {
    ...base,
    categoryIds: normalizeTierNightLivePrepCategoryIds(base.categoryIds),
    roundCount:
      roundRaw == null || roundRaw === ""
        ? TIER_NIGHT_LIVE_PREP_DEFAULT_ROUND_COUNT
        : isValidTierNightLiveRoundCount(Number(roundRaw))
          ? Number(roundRaw)
          : TIER_NIGHT_LIVE_PREP_DEFAULT_ROUND_COUNT,
  };
}

async function syncTierNightLivePrepSession(extra = {}, patchOpts = {}) {
  const merged = {
    ...getTierNightLivePrepSession(),
    ...extra,
  };
  const session = {
    ...merged,
    categoryIds: normalizeTierNightLivePrepCategoryIds(
      extra.categoryIds !== undefined ? extra.categoryIds : merged.categoryIds
    ),
  };
  saveStatePatch({ tierNightLiveSeriesPrep: session });
  if (!isGameSyncActive()) return session;
  await patchGameState(
    { tierNightLivePrep: tierNightLivePrepToRemote(session) },
    { gameId: "tiernight", screen: "tiernight-live-prep", ...patchOpts }
  );
  return session;
}

/**
 * Host change roundCount : mutation roundCount UNIQUEMENT.
 * Ready et setupEpoch restent inchangés (contrat Rank Live QA-02).
 * Race launch : RPC 04E rejette proposal.roundCount ≠ prep.roundCount
 * même sans bump epoch ; attempt in-flight invalidée si longueur change.
 */
export async function setTierNightLivePrepRoundCount(roundCount) {
  if (isGameSyncActive() && !isLobbyHost()) {
    return { ok: false, code: "HOST_ONLY", message: "Seul l'hôte modifie la longueur." };
  }
  const n = Number(roundCount);
  if (!isValidTierNightLiveRoundCount(n)) {
    return { ok: false, code: "INVALID_ROUND_COUNT" };
  }
  const prev = getTierNightLivePrepSession();
  const avail = getTierNightLiveRoundCountAvailability(
    prev.categoryIds,
    livePrepPoolOpts()
  ).find((a) => a.roundCount === n);
  if (!avail?.available) {
    return { ok: false, code: "INSUFFICIENT_POOL" };
  }
  const changed = Number(prev.roundCount) !== n;
  if (changed) {
    clearInFlightTierNightLiveLaunchAttempt();
  }
  await syncTierNightLivePrepSession({
    roundCount: n,
    ready: prev.ready,
    setupEpoch: prev.setupEpoch,
  });
  return { ok: true };
}

/**
 * Host change categoryIds : ready + setupEpoch inchangés (contrat Rank Live).
 * Pas de clamp silencieux de roundCount ; l'UI/launch refusent une longueur trop grande.
 */
export async function setTierNightLivePrepCategories(categoryIds) {
  if (isGameSyncActive() && !isLobbyHost()) {
    return { ok: false, code: "HOST_ONLY", message: "Seul l'hôte modifie les catégories." };
  }
  const shape = validateTierNightLiveSeriesCategoryIds(categoryIds);
  if (!shape.ok) {
    return { ok: false, code: shape.code, message: shape.message };
  }
  const prev = getTierNightLivePrepSession();
  const changed = !categoryIdsEqual(prev.categoryIds, shape.categoryIds);
  if (changed) {
    clearInFlightTierNightLiveLaunchAttempt();
  }
  await syncTierNightLivePrepSession({
    categoryIds: shape.categoryIds,
    ready: prev.ready,
    setupEpoch: prev.setupEpoch,
  });
  return { ok: true };
}

export async function setTierNightLivePrepReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getTierNightLivePrepSession,
    saveLocal: (session) => saveStatePatch({ tierNightLiveSeriesPrep: session }),
    stateKey: "tierNightLivePrep",
    gameId: "tiernight",
    screen: "tiernight-live-prep",
    buildRemoteReadyPatch: (uid, readyVal, session) => ({
      ready: { [uid]: Boolean(readyVal) },
      expectedSetupEpoch: Number(session.setupEpoch) || 0,
    }),
    isBenignRemoteFailure: (err) =>
      /Ready obsolète|expectedSetupEpoch|setupEpoch diverg/i.test(
        String(err?.message || err || "")
      ),
  });
}

export function allTierNightLivePrepReady() {
  const session = getTierNightLivePrepSession();
  if (isGameSyncActive()) {
    return allMembersReady(session.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export function simulateTierNightLivePrepReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    void setTierNightLivePrepReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export function resetTierNightLivePrepSession() {
  const prev = getTierNightLivePrepSession();
  const setupEpoch = (Number(prev.setupEpoch) || 0) + 1;
  saveStatePatch({
    tierNightLiveSeriesPrep: {
      ...defaultLivePrepSession(),
      setupEpoch,
    },
  });
}

export function getTierNightLivePrepSummary() {
  const session = getTierNightLivePrepSession();
  const opts = livePrepPoolOpts();
  const poolSize = getTierNightLivePoolSize(session.categoryIds, opts);
  const roundCountAvailability = getTierNightLiveRoundCountAvailability(
    session.categoryIds,
    opts
  );
  const requested = session.roundCount;
  const available =
    isValidTierNightLiveRoundCount(requested) &&
    poolSize >= Number(requested);
  const duration = estimateTierNightSeriesDuration(available ? Number(requested) : 0);
  return {
    categoryIds: session.categoryIds,
    categorySummary: formatTierNightLiveCategorySummary(session.categoryIds),
    poolSize,
    roundCountAvailability,
    requested,
    roundCount: session.roundCount,
    available,
    effective: available ? Number(requested) : 0,
    durationLabel: available ? duration.label : "-",
  };
}


export function listSharedCustomLiveTierListsForPrep() {
  return listCustomLiveTierLists();
}

export function isOwnCustomLiveTierList(entry) {
  const uid = getSupabaseUserId() || null;
  return isCustomLiveTierListOwnedBy(entry, getLocalDisplayName(), uid);
}

export async function addCustomLiveTierListFromPrep(input) {
  return addCustomLiveTierListAndSync(input);
}

export async function removeCustomLiveTierListFromPrep(id) {
  return deleteCustomLiveTierListAndSync(id);
}

export function getTierNightLivePrepEntryScreen() {
  const live = getState().tierNightLiveGame;
  if (live?.lobbyStarted && !live?.finished) return "tiernight-live";
  if (live?.series && typeof live.series === "object" && live.series.kind === "live") {
    const phase = live.series.phase;
    if (phase && phase !== "series_end") return "tiernight-live";
  }
  return "tiernight-live-prep";
}

/**
 * Entrée prep live depuis select.
 * @param {{ resetSettings?: boolean }} [opts]
 */
export async function enterTierNightLivePrep({ resetSettings = true } = {}) {
  if (resetSettings) {
    resetTierNightLivePrepSession();
  }
  const session = getTierNightLivePrepSession();
  const navOpts = {
    navStack: ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"],
  };

  // Idle clear (pas finishedTierNightLiveRemote) : prep ouverte, série absente,
  // pool customs réouvert — restart game-select / re-entrée select→prep.
  const liveIdleClear = {
    runId: null,
    lobbyStarted: false,
    finished: false,
    series: null,
    topicId: null,
    listName: "",
    deck: null,
    playerRoster: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    placements: {},
  };

  if (!isGameSyncActive()) {
    if (resetSettings) {
      clearInFlightTierNightLiveLaunchAttempt();
      saveStatePatch({
        tierNightLiveGame: liveIdleClear,
        customLiveTierListsWritable: true,
      });
    }
    navigate("tiernight-live-prep", navOpts);
    return { ok: true, localOnly: true };
  }

  if (isLobbyHost() && resetSettings) {
    try {
      clearInFlightTierNightLiveLaunchAttempt();
      // Clear blob live + réouvre le pool (writable reste false après un launch 04E
      // et startGameSession le préserve — sans ce patch, delete custom → LOCKED).
      saveStatePatch({
        tierNightLiveGame: liveIdleClear,
        customLiveTierListsWritable: true,
      });
      await patchGameState(
        {
          tierNightLivePrep: tierNightLivePrepToRemote(session),
          tierNightLive: liveIdleClear,
          customLiveTierListsWritable: true,
        },
        { gameId: "tiernight", screen: "tiernight-live-prep" }
      );
    } catch (err) {
      return {
        ok: false,
        error: err?.message || "Impossible d'ouvrir la préparation Rank Live.",
      };
    }
  }

  navigate("tiernight-live-prep", navOpts);
  return { ok: true };
}

/**
 * FEATURE-TIERNIGHT-04E - launch canonique série Rank Live.
 * Client prépare la queue (TIER_LISTS + customs) ; MP commit via RPC.
 * @param {{ rosterNames?: string[] }} [_opts]
 */
export async function markTierNightLiveSeriesPrepStarted(_opts = {}) {
  if (isGameSyncActive() && !isLobbyHost()) {
    return {
      ok: false,
      code: "TNS_LIVE_HOST_REQUIRED",
      error: mapTierNightLiveLaunchError("TNS_LIVE_HOST_REQUIRED"),
    };
  }

  const prep = getTierNightLivePrepSession();
  const expectedSetupEpoch = Number(prep.setupEpoch) || 0;

  const attempt = obtainTierNightLiveLaunchAttempt({
    prep,
    officialLists: getTierNightLiveOfficialPool(prep.categoryIds),
    customLists: listCustomLiveTierLists(),
  });
  if (!attempt?.ok) {
    clearInFlightTierNightLiveLaunchAttempt();
    return {
      ok: false,
      code: attempt?.code || "TNS_LIVE_LAUNCH_FAILED",
      error: mapTierNightLiveLaunchError(attempt?.code),
    };
  }

  if (!isGameSyncActive()) {
    const built = buildTierNightLiveSeriesLaunchState({
      customLists: listCustomLiveTierLists(),
      officialLists: getTierNightLiveOfficialPool(prep.categoryIds),
      roundCount: prep.roundCount,
      categoryIds: prep.categoryIds,
      playerRoster: buildTierNightPlayerRoster(getLobbyParticipants()),
      runId: attempt.runId,
      setupEpoch: expectedSetupEpoch,
    });
    if (!built.ok) {
      clearInFlightTierNightLiveLaunchAttempt();
      return {
        ok: false,
        code: built.code,
        error: mapTierNightLiveLaunchError(built.code),
      };
    }
    saveStatePatch({
      tierNightLiveGame: built.live,
      customLiveTierListsWritable: false,
      tierNightMode: "live",
    });
    const { ensureGameScoreSessionForRun } = await import("./state.js");
    ensureGameScoreSessionForRun({
      gameId: "tiernight",
      mode: "live",
      runId: built.series.runId,
    });
    clearInFlightTierNightLiveLaunchAttempt();
    return { ok: true, localOnly: true, series: built.series };
  }

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) {
    return {
      ok: false,
      code: "TNS_LIVE_LAUNCH_FAILED",
      error: mapTierNightLiveLaunchError("TNS_LIVE_LAUNCH_FAILED"),
    };
  }

  try {
    await setLobbyPlaying("tiernight");
  } catch {
    /* non bloquant */
  }

  let row;
  try {
    row = await rpcStartTierNightLiveSeries({
      lobbyId,
      expectedSetupEpoch,
      series: attempt.series,
    });
  } catch (err) {
    try {
      const refreshed = await refreshGameSession();
      const live =
        refreshed?.state?.tierNightLive || getCachedGameSession()?.state?.tierNightLive;
      const remoteRun =
        live?.series?.runId || live?.runId || null;
      if (
        live?.lobbyStarted &&
        live?.series?.kind === "live" &&
        !live?.finished &&
        remoteRun === attempt.runId
      ) {
        applyRemoteSession(refreshed || getCachedGameSession());
        clearInFlightTierNightLiveLaunchAttempt();
        return { ok: true, reconciled: true, row: refreshed || getCachedGameSession() };
      }
      if (
        live?.lobbyStarted &&
        live?.series?.kind === "live" &&
        !live?.finished &&
        remoteRun &&
        remoteRun !== attempt.runId
      ) {
        applyRemoteSession(refreshed || getCachedGameSession());
        clearInFlightTierNightLiveLaunchAttempt();
        return {
          ok: false,
          code: "TNS_LIVE_ALREADY_STARTED",
          error: mapTierNightLiveLaunchError("TNS_LIVE_ALREADY_STARTED"),
          followedRemote: true,
        };
      }
    } catch {
      /* ignore */
    }
    const code = extractTierNightLiveLaunchCode(err);
    if (
      code === "TNS_LIVE_PREP_STALE" ||
      code === "TNS_LIVE_ALREADY_STARTED" ||
      code === "TNS_LIVE_CUSTOM_POOL_STALE"
    ) {
      clearInFlightTierNightLiveLaunchAttempt();
    }
    // Timeout / fail réel : conserve attempt (même runId) pour retry.
    return {
      ok: false,
      code,
      error: mapTierNightLiveLaunchError(code, err?.message),
    };
  }

  if (row) {
    applyRemoteSession(row);
    const runId = row?.state?.tierNightLive?.runId || row?.state?.tierNightLive?.series?.runId;
    if (runId) {
      const { ensureGameScoreSessionForRun } = await import("./state.js");
      ensureGameScoreSessionForRun({ gameId: "tiernight", mode: "live", runId });
    }
  }
  clearInFlightTierNightLiveLaunchAttempt();
  return { ok: true, row };
}

/**
 * Soft check client avant CTA (serveur reste autorité).
 * Ne bloque plus avec le stub 04D.
 */
export function validateTierNightLivePrepForLaunch() {
  const prep = getTierNightLivePrepSession();
  if (!isValidTierNightLiveRoundCount(prep.roundCount)) {
    return {
      ok: false,
      code: "TNS_LIVE_INVALID_ROUND_COUNT",
      message: mapTierNightLiveLaunchError("TNS_LIVE_INVALID_ROUND_COUNT"),
      icon: "⚠️",
    };
  }
  const probe = buildTierNightLiveSeriesLaunchState({
    customLists: listCustomLiveTierLists(),
    officialLists: getTierNightLiveOfficialPool(prep.categoryIds),
    roundCount: prep.roundCount,
    categoryIds: prep.categoryIds,
    playerRoster: [],
    // Déterministe : on ne consomme pas le RNG réel ici - juste capacité.
    random: () => 0.5,
    deckRandom: () => 0.5,
  });
  if (!probe.ok) {
    return {
      ok: false,
      code: probe.code,
      message: mapTierNightLiveLaunchError(probe.code),
      icon: "⚠️",
    };
  }
  return { ok: true };
}

/** @deprecated alias - anciennes imports stub */
export function validateTierNightLivePrepLaunchPending() {
  return validateTierNightLivePrepForLaunch();
}
