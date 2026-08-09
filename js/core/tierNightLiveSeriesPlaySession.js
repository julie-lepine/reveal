/**
 * FEATURE-TIERNIGHT-04F — orchestration finalize / advance série Rank Live (host-commit).
 *
 * Autorité : `patchGameState` (04A) — pas de RPC finalize/advance dédiée.
 * Scoring : `buildRecapsFromPlacements(..., { applyScores: false })` +
 * `applyTierNightLiveSeriesListScores` (ledger scoredRoundIds).
 */

import { getState, saveStatePatch } from "./state.js";
import { createActionLock } from "./actionLock.js";
import { navigate } from "./router.js";
import {
  canActAsHost,
  isGameSyncActive,
  isLobbyHost,
  patchGameState,
  getCachedGameSession,
  tierNightLiveToRemote,
  tierNightRecapToRemote,
  getTierNightRemote,
} from "./gameSync.js";
import {
  buildRecapsFromPlacements,
  applyTierNightLiveSeriesListScores,
  getTierNightSession,
} from "./tierNightSession.js";
import {
  TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN,
  TIER_NIGHT_LIVE_SERIES_PHASE_END,
  TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING,
  getActiveTierNightLiveSeriesRound,
  isTierNightLiveSeriesLastRound,
  projectTierNightLiveSeriesRound,
} from "./tierNightLiveSeriesRuntime.js";
import { rpcClearTierNightCustomLiveTierLists } from "./gameSessionRpc.js";
import { clearCustomLiveTierListsLocal } from "./customLiveTierListSession.js";
import { finishedTierNightLiveRemote } from "./tierNightConfig.js";

const finalizeLock = createActionLock();
const advanceLock = createActionLock();

/** Tests uniquement. */
export function __testGetLiveSeriesPlayLocks() {
  return { finalizeLock, advanceLock };
}

function canHostLiveSeriesCommit() {
  if (!isGameSyncActive()) return true;
  return isLobbyHost() || canActAsHost();
}

function getLobbyId() {
  return getState()?.lobby?.id || null;
}

/**
 * Contexte série live (remote prioritaire si sync, sinon local).
 */
export function getTierNightLiveSeriesContext() {
  const remote = getCachedGameSession()?.state?.tierNightLive || null;
  const local = getState().tierNightLiveGame || null;
  // Gameplay autoritatif hôte = local (placements / deck). Series wire : remote si sync.
  const series =
    (remote?.series && typeof remote.series === "object" ? remote.series : null) ||
    (local?.series && typeof local.series === "object" ? local.series : null) ||
    null;
  const live = {
    ...(local || {}),
    series,
    placements: local?.placements || {},
    deck: local?.deck || remote?.deck || null,
    playerRoster: local?.playerRoster || remote?.playerRoster || [],
  };
  return { live, series, local, remote };
}

/**
 * @param {string|null|undefined} phase
 * @returns {string|null}
 */
export function resolveTierNightLiveSeriesScreenFromPhase(phase) {
  switch (phase) {
    case TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING:
      return "tiernight-live";
    case TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN:
      return "tiernight-between";
    case TIER_NIGHT_LIVE_SERIES_PHASE_END:
      return "tiernight-end";
    default:
      return null;
  }
}

/**
 * @param {string|null|undefined} phase
 * @param {{ navStack?: string[] }} [opts]
 */
export function navigateForTierNightLiveSeriesPhase(phase, { navStack } = {}) {
  const screen = resolveTierNightLiveSeriesScreenFromPhase(phase);
  if (!screen) return false;
  const stack =
    navStack ||
    (screen === "tiernight-end"
      ? [
          "home",
          "lobby",
          "game-select",
          "tiernight-select",
          "tiernight-live-prep",
          "tiernight-live",
          "tiernight-end",
        ]
      : screen === "tiernight-between"
        ? [
            "home",
            "lobby",
            "game-select",
            "tiernight-select",
            "tiernight-live-prep",
            "tiernight-live",
            "tiernight-between",
          ]
        : [
            "home",
            "lobby",
            "game-select",
            "tiernight-select",
            "tiernight-live-prep",
            "tiernight-live",
          ]);
  navigate(screen, { navStack: stack });
  return true;
}

/**
 * Invité / sync : suivre la phase live série.
 */
export function followTierNightLiveSeriesPhaseFromRow(row, { shouldContinue = null } = {}) {
  const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();
  const phase = row?.state?.tierNightLive?.series?.phase;
  const screen = resolveTierNightLiveSeriesScreenFromPhase(phase);
  if (!screen || !canContinue()) return false;
  navigateForTierNightLiveSeriesPhase(phase);
  return true;
}

/**
 * Follow depuis l’écran between (live ou remote phase).
 */
export function followTierNightLiveSeriesBetweenScreen(row, { shouldContinue = null } = {}) {
  const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();
  if (!canContinue()) return false;
  const phase = row?.state?.tierNightLive?.series?.phase;
  if (phase === TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING) {
    navigateForTierNightLiveSeriesPhase(phase);
    return true;
  }
  if (phase === TIER_NIGHT_LIVE_SERIES_PHASE_END) {
    navigateForTierNightLiveSeriesPhase(phase);
    return true;
  }
  return false;
}

function cloneSeries(series) {
  return JSON.parse(JSON.stringify(series));
}

function buildLiveRoundRecap({
  series,
  roundId,
  roundIndex,
  listId,
  listSnapshot,
  recaps,
  sessionMeta,
}) {
  const snap = listSnapshot && typeof listSnapshot === "object" ? listSnapshot : {};
  const topicSnapshot = {
    id: String(snap.id || listId || ""),
    name: String(snap.name || sessionMeta?.listName || ""),
    emoji: snap.emoji != null ? String(snap.emoji) : "📋",
  };
  return {
    roundId,
    roundIndex,
    listId: String(listId || snap.id || ""),
    listName: topicSnapshot.name,
    recaps: Array.isArray(recaps) ? recaps : [],
    consensus: sessionMeta?.consensus ?? null,
    controversialItem: sessionMeta?.controversialItem ?? null,
    controversialSpread: sessionMeta?.controversialSpread ?? 0,
    listSnapshot: { ...snap, items: Array.isArray(snap.items) ? snap.items.map(String) : [] },
    topicSnapshot,
  };
}

function applyLiveSeriesLocalState({ liveNext, tierNightPatch = null }) {
  const patch = {
    tierNightLiveGame: liveNext,
  };
  if (tierNightPatch) {
    const cur = getTierNightSession();
    patch.tierNightGame = { ...cur, ...tierNightPatch };
  }
  saveStatePatch(patch);
}

async function clearCustomsBestEffortOnSeriesEnd() {
  try {
    clearCustomLiveTierListsLocal();
  } catch (err) {
    console.warn("[TierNightLive] clear customs local failed:", err);
  }
  if (!isGameSyncActive()) return { ok: true, localOnly: true };
  const lobbyId = getLobbyId();
  if (!lobbyId || !isLobbyHost()) return { ok: true, skipped: true };
  try {
    await rpcClearTierNightCustomLiveTierLists({ lobbyId, reopen: true });
    return { ok: true, cleared: true };
  } catch (err) {
    console.warn("[TierNightLive] clear customs RPC failed (scoring preserved):", err);
    return { ok: false, error: err };
  }
}

/**
 * Hôte : finalise la liste courante → between_lists | series_end.
 */
export async function hostFinalizeTierNightLiveSeriesList({
  force = false,
  shouldContinue = null,
} = {}) {
  void force;
  const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();

  if (!canHostLiveSeriesCommit()) {
    return { ok: false, unauthorized: true, code: "TNS_LIVE_UNAUTHORIZED" };
  }

  const outcome = await finalizeLock.run(async () => {
    const { live, series: seriesRaw } = getTierNightLiveSeriesContext();
    if (!seriesRaw || seriesRaw.kind !== "live" || !Array.isArray(seriesRaw.queue)) {
      return { ok: false, code: "TNS_LIVE_NO_SERIES", validation: true };
    }

    const series = cloneSeries(seriesRaw);
    const active = getActiveTierNightLiveSeriesRound(series);
    if (!active.ok) {
      return { ok: false, code: active.code || "TNS_LIVE_NO_ROUND", validation: true };
    }
    const roundId = String(active.round.roundId);
    const roundIndex = Number(series.roundIndex);
    const scored = Array.isArray(series.scoredRoundIds)
      ? series.scoredRoundIds.map(String)
      : [];
    const completed = Array.isArray(series.completedRoundIds)
      ? series.completedRoundIds.map(String)
      : [];

    // Idempotent : déjà scorée → naviguer selon phase courante / attendue.
    if (scored.includes(roundId)) {
      const phase =
        series.phase === TIER_NIGHT_LIVE_SERIES_PHASE_END ||
        series.phase === TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN
          ? series.phase
          : isTierNightLiveSeriesLastRound(series)
            ? TIER_NIGHT_LIVE_SERIES_PHASE_END
            : TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN;
      if (canContinue()) navigateForTierNightLiveSeriesPhase(phase);
      return { ok: true, applied: false, code: "ALREADY_APPLIED", phase, roundId };
    }

    if (series.phase !== TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING) {
      return {
        ok: false,
        code: "TNS_LIVE_INVALID_PHASE",
        phase: series.phase,
        stale: true,
      };
    }

    const snap = active.round.listSnapshot || {};
    const items = Array.isArray(live?.deck) && live.deck.length
      ? live.deck.map(String)
      : Array.isArray(snap.items)
        ? snap.items.map(String)
        : [];
    const listId = String(active.round.listId || snap.id || live?.topicId || "");
    const listName = String(snap.name || live?.listName || "");

    const recaps = buildRecapsFromPlacements(
      listId,
      listName,
      items,
      live?.placements || {},
      { applyScores: false }
    );

    const isLast = isTierNightLiveSeriesLastRound(series);
    const nextPhase = isLast
      ? TIER_NIGHT_LIVE_SERIES_PHASE_END
      : TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN;

    applyTierNightLiveSeriesListScores({
      roundId,
      recaps,
      isSeriesEnd: isLast,
      series,
    });

    const sessionMeta = getTierNightSession();
    const roundRecap = buildLiveRoundRecap({
      series,
      roundId,
      roundIndex,
      listId,
      listSnapshot: snap,
      recaps,
      sessionMeta,
    });

    const historyEntry = {
      roundId,
      roundIndex,
      listId,
      listName: roundRecap.listName,
      topicSnapshot: roundRecap.topicSnapshot,
      listSnapshot: roundRecap.listSnapshot,
    };

    const nextSeries = {
      ...series,
      phase: nextPhase,
      scoredRoundIds: [...scored, roundId],
      completedRoundIds: completed.includes(roundId)
        ? [...completed]
        : [...completed, roundId],
      roundHistory: [
        ...(Array.isArray(series.roundHistory) ? series.roundHistory : []),
        historyEntry,
      ],
      roundRecap,
    };

    const liveBase = {
      ...(live || {}),
      series: nextSeries,
      runId: series.runId || live?.runId || null,
      topicId: listId,
      listName,
      placements: live?.placements || {},
      deck: items,
      playerRoster: live?.playerRoster || [],
      votes: {},
      roundIdx: 0,
    };

    let liveNext;
    if (nextPhase === TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN) {
      liveNext = {
        ...liveBase,
        lobbyStarted: true,
        finished: false,
        phase: "between",
        series: nextSeries,
      };
    } else {
      liveNext = {
        ...finishedTierNightLiveRemote({
          ...liveBase,
          series: nextSeries,
        }),
        series: nextSeries,
        phase: "done",
      };
    }

    const tnRecap = tierNightRecapToRemote(getTierNightSession());
    const tnRemote = getTierNightRemote() || {};
    const tierNightPatch = {
      lobbyStarted: false,
      ...(tnRecap
        ? {
            recap: tnRecap,
            ...tnRecap,
            recapSynced: true,
          }
        : {}),
      listName,
      topicId: listId,
    };

    applyLiveSeriesLocalState({ liveNext, tierNightPatch });

    if (isGameSyncActive()) {
      try {
        await patchGameState(
          {
            tierNightLive: tierNightLiveToRemote(liveNext),
            tierNight: {
              ...tnRemote,
              lobbyStarted: false,
              ...(tnRecap ? { recap: tnRecap } : {}),
            },
          },
          {
            screen:
              nextPhase === TIER_NIGHT_LIVE_SERIES_PHASE_END
                ? "tiernight-end"
                : "tiernight-between",
            gameId: "tiernight",
            withEveningScores: true,
          }
        );
      } catch (err) {
        console.warn("[TierNightLive] finalize patch failed:", err);
        return { ok: false, code: "TNS_LIVE_PATCH_FAILED", error: err };
      }
    }

    if (nextPhase === TIER_NIGHT_LIVE_SERIES_PHASE_END) {
      await clearCustomsBestEffortOnSeriesEnd();
    }

    if (canContinue()) {
      navigateForTierNightLiveSeriesPhase(nextPhase);
    }

    return {
      ok: true,
      applied: true,
      phase: nextPhase,
      roundId,
      roundIndex,
      isLast,
      series: nextSeries,
    };
  });

  if (outcome.skipped) return { ok: false, skipped: true, code: "TNS_LIVE_IN_FLIGHT" };
  return outcome.value;
}

/**
 * Hôte : between_lists → playing_list (liste suivante).
 */
export async function hostAdvanceTierNightLiveSeriesList({ shouldContinue = null } = {}) {
  const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();

  if (!canHostLiveSeriesCommit()) {
    return { ok: false, unauthorized: true, code: "TNS_LIVE_UNAUTHORIZED" };
  }

  const outcome = await advanceLock.run(async () => {
    const { live, series: seriesRaw } = getTierNightLiveSeriesContext();
    if (!seriesRaw || seriesRaw.kind !== "live" || !Array.isArray(seriesRaw.queue)) {
      return { ok: false, code: "TNS_LIVE_NO_SERIES", validation: true };
    }

    const series = cloneSeries(seriesRaw);
    if (series.phase !== TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN) {
      return {
        ok: false,
        code: "TNS_LIVE_INVALID_PHASE",
        phase: series.phase,
        stale: true,
      };
    }

    const active = getActiveTierNightLiveSeriesRound(series);
    if (!active.ok) {
      return { ok: false, code: active.code || "TNS_LIVE_NO_ROUND", validation: true };
    }
    const currentRoundId = String(active.round.roundId);
    const scored = Array.isArray(series.scoredRoundIds)
      ? series.scoredRoundIds.map(String)
      : [];
    const completed = Array.isArray(series.completedRoundIds)
      ? series.completedRoundIds.map(String)
      : [];
    if (!scored.includes(currentRoundId) || !completed.includes(currentRoundId)) {
      return { ok: false, code: "TNS_LIVE_ROUND_NOT_SCORED", validation: true };
    }
    if (isTierNightLiveSeriesLastRound(series)) {
      return { ok: false, code: "TNS_LIVE_NO_NEXT_ROUND", noNextRound: true };
    }

    const nextIndex = Number(series.roundIndex) + 1;
    // Préserver l’immutabilité de la queue (même références sérialisées).
    const queueSnapshot = series.queue;
    const nextSeriesBase = {
      ...series,
      queue: queueSnapshot,
      roundIndex: nextIndex,
      phase: TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING,
      roundRecap: null,
    };

    const projected = projectTierNightLiveSeriesRound(
      nextSeriesBase,
      nextIndex,
      live?.playerRoster || [],
      Math.random
    );
    if (!projected.ok) {
      return { ok: false, code: projected.code || "TNS_LIVE_PROJECT_FAILED" };
    }

    const nextSeries = {
      ...nextSeriesBase,
      // roundRecap cleared ; ledgers / history / queue préservés
    };

    const liveNext = {
      ...projected.live,
      series: nextSeries,
      lobbyStarted: true,
      finished: false,
    };

    applyLiveSeriesLocalState({ liveNext });

    if (isGameSyncActive()) {
      try {
        await patchGameState(
          { tierNightLive: tierNightLiveToRemote(liveNext) },
          { screen: "tiernight-live", gameId: "tiernight", withEveningScores: false }
        );
      } catch (err) {
        console.warn("[TierNightLive] advance patch failed:", err);
        return { ok: false, code: "TNS_LIVE_PATCH_FAILED", error: err };
      }
    }

    if (canContinue()) {
      navigateForTierNightLiveSeriesPhase(TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING);
    }

    return {
      ok: true,
      applied: true,
      phase: TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING,
      roundIndex: nextIndex,
      series: nextSeries,
      queue: nextSeries.queue,
    };
  });

  if (outcome.skipped) return { ok: false, skipped: true, code: "TNS_LIVE_IN_FLIGHT" };
  return outcome.value;
}
