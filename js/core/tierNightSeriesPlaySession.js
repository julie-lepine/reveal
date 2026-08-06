/**
 * FEATURE-TIERNIGHT-03-D / D1 / D1-bis — orchestration finalize / advance / résolution d’écran série.
 *
 * Scoring autoritatif = SQL (RPC). Le client ne recalcule pas les points en MP.
 * Machine d’état canonique : ranking → between_rounds | series_end → ranking…
 * round_result : phase SERIES-00 jamais produite — retirée (Option A D1-bis).
 */

import { getState, saveStatePatch } from "./state.js";
import { createActionLock } from "./actionLock.js";
import {
  buildTierNightSeriesRoundId,
  doesTierNightSeriesEventMatch,
  getActiveTierNightSeriesRound,
  isRetiredTierNightSeriesPhase,
  isTierNightSeriesLastRound,
  validateTierNightSeries,
} from "./tierNightSeries.js";
import { commitTierNightSeriesRoundResult } from "./tierNightSeriesFinalize.js";
import { commitTierNightSeriesNextRound } from "./tierNightSeriesAdvance.js";
import {
  allTierNightMembersFinished,
  applyRemoteLobbyScores,
  canActAsHost,
  isGameSyncActive,
  isLobbyHost,
  refreshGameSession,
  getCachedGameSession,
} from "./gameSync.js";
import { navigate } from "./router.js";

const finalizeLock = createActionLock();
const advanceLock = createActionLock();

/** Identité de transition en cours (tests + garde stale). */
let finalizeTransitionId = null;
let advanceTransitionId = null;

/** Tests uniquement. */
export function __testGetSeriesPlayLocks() {
  return {
    finalizeLock,
    advanceLock,
    get finalizeTransitionId() {
      return finalizeTransitionId;
    },
    get advanceTransitionId() {
      return advanceTransitionId;
    },
  };
}

/**
 * Identité de verrou / transition : action + runId + roundId + phase attendue.
 * @param {"finalize"|"advance"} action
 * @param {{ runId?: string|null, roundId?: string|null, phase?: string|null }} parts
 */
export function buildTierNightSeriesTransitionId(action, { runId, roundId, phase } = {}) {
  return [
    String(action || ""),
    String(runId || ""),
    String(roundId || ""),
    String(phase || ""),
  ].join("|");
}

/**
 * @param {object|null|undefined} session — tierNightGame / remote tierNight
 */
export function hasActiveTierNightSeries(session = getState().tierNightGame) {
  const series = session?.series;
  if (!series || typeof series !== "object") return false;
  const phase = series.phase;
  return typeof phase === "string" && phase.length > 0;
}

/**
 * Mapping phase série → écran produit.
 * round_result retiré : null (rejet / pas d’écran jouable).
 * @param {string|null|undefined} phase
 * @returns {string|null}
 */
export function resolveTierNightSeriesScreenFromPhase(phase) {
  if (isRetiredTierNightSeriesPhase(phase)) return null;
  switch (phase) {
    case "ranking":
      return "tiernight";
    case "between_rounds":
      return "tiernight-between";
    case "series_end":
      return "tiernight-end";
    default:
      return null;
  }
}

/**
 * CTA « Thème suivant » / advance RPC : uniquement between_rounds.
 * @param {string|null|undefined} phase
 */
export function canAdvanceTierNightSeriesFromPhase(phase) {
  return phase === "between_rounds";
}

/**
 * Sortie / rejet d’un blob phase round_result (Option A).
 * @returns {{ ok: false, code: string, retired: true, deadEnd: false }}
 */
export function resolveRetiredTierNightSeriesPhase(phase) {
  if (!isRetiredTierNightSeriesPhase(phase)) {
    return { ok: true, retired: false };
  }
  return {
    ok: false,
    code: "TNS_PHASE_RETIRED",
    retired: true,
    // Pas d’impasse produit : état non valide → pas d’écran between / pas de CTA sync.
    deadEnd: false,
    message: "Phase série obsolète (round_result). Relancer la série depuis le prep.",
  };
}

/**
 * Destination depuis un blob tierNight partagé (phase prioritaire).
 * @param {object|null|undefined} tierNight
 */
export function resolveTierNightSeriesPlayScreen(tierNight) {
  const series = tierNight?.series;
  if (!series || typeof series !== "object") return null;
  return resolveTierNightSeriesScreenFromPhase(series.phase);
}

/**
 * Mapping codes RPC → UX (aucun message SQL brut).
 * @param {string|null|undefined} code
 * @param {"finalize"|"advance"} [action="finalize"]
 */
export function mapTierNightSeriesRpcErrorToUx(code, action = "finalize") {
  const c = String(code || "");
  const table = {
    ALREADY_APPLIED: {
      terminal: true,
      reconciliable: true,
      retry: false,
      message: "Cette manche est déjà finalisée.",
    },
    ALREADY_ADVANCED: {
      terminal: true,
      reconciliable: true,
      retry: false,
      message: "La manche suivante est déjà lancée.",
    },
    TNS_PLACEMENTS_INCOMPLETE: {
      terminal: false,
      reconciliable: false,
      retry: true,
      message: "Tous les joueurs n’ont pas encore terminé leur classement.",
    },
    TNS_FORCE_NO_FINISHED: {
      terminal: false,
      reconciliable: false,
      retry: true,
      message: "Aucun joueur n’a terminé : impossible de forcer les résultats.",
    },
    TNS_STALE_RUN: {
      terminal: true,
      reconciliable: false,
      retry: false,
      message: "Cette série n’est plus active.",
    },
    TNS_STALE_ROUND_ID: {
      terminal: true,
      reconciliable: false,
      retry: false,
      message: "Cette manche n’est plus la manche active.",
    },
    TNS_STALE_ROUND_INDEX: {
      terminal: true,
      reconciliable: false,
      retry: false,
      message: "Cette manche n’est plus la manche active.",
    },
    TNS_INVALID_PHASE: {
      terminal: true,
      reconciliable: true,
      retry: false,
      message: "L’étape de la série a changé.",
    },
    TNS_SERIES_ENDED: {
      terminal: true,
      reconciliable: true,
      retry: false,
      message: "La série est terminée.",
    },
    TNS_PHASE_RETIRED: {
      terminal: true,
      reconciliable: false,
      retry: false,
      message: "État de série obsolète. Relancez depuis le prep.",
    },
    TNS_NO_NEXT_ROUND: {
      terminal: true,
      reconciliable: false,
      retry: false,
      message: "Il n’y a plus de thème suivant.",
    },
    TNS_UNAUTHORIZED: {
      terminal: true,
      reconciliable: false,
      retry: false,
      message: "Seul l’hôte peut continuer.",
    },
    TNS_AUTH_REQUIRED: {
      terminal: true,
      reconciliable: false,
      retry: true,
      message: "Connexion requise.",
    },
    TNS_TIMEOUT: {
      terminal: false,
      reconciliable: true,
      retry: true,
      message: "Délai dépassé. Vérification de l’état…",
    },
    TNS_IN_FLIGHT: {
      terminal: false,
      reconciliable: false,
      retry: false,
      message: null,
    },
    TNS_ROUND_NOT_SCORED: {
      terminal: false,
      reconciliable: false,
      retry: false,
      message: "La manche n’est pas encore finalisée.",
    },
  };
  const hit = table[c];
  if (hit) {
    return { code: c, action, ...hit };
  }
  return {
    code: c || "TNS_UNKNOWN",
    action,
    terminal: false,
    reconciliable: true,
    retry: true,
    message:
      action === "advance"
        ? "Impossible de passer au thème suivant."
        : "Impossible de finaliser la manche.",
  };
}

function getLobbyId() {
  return getState()?.lobby?.id || null;
}

function getSeriesContext() {
  const remote = getCachedGameSession()?.state?.tierNight;
  const local = getState().tierNightGame;
  const tn = remote || local || {};
  const runId = tn.runId || local?.runId || null;
  const series = tn.series || local?.series || null;
  return { tn, runId, series, local, remote };
}

/**
 * Garde pré-finalize / pré-advance.
 */
export function assertCanFinalizeTierNightSeriesRound({
  runId,
  series,
  force = false,
} = {}) {
  if (!runId || !series) {
    return { ok: false, code: "TNS_NO_SERIES", validation: true };
  }
  const validation = validateTierNightSeries(series, { runId });
  if (!validation.ok) {
    return { ok: false, code: validation.code, validation: true };
  }
  const s = validation.series;
  const active = getActiveTierNightSeriesRound(s);
  if (!active.ok) {
    return { ok: false, code: active.code, validation: true };
  }
  const roundId = active.round.roundId;
  const expectedId = buildTierNightSeriesRoundId(runId, s.roundIndex);
  if (roundId !== expectedId) {
    return { ok: false, code: "TNS_ROUND_ID_MISMATCH", stale: true };
  }
  const scored = Array.isArray(s.scoredRoundIds) ? s.scoredRoundIds.map(String) : [];
  // Idempotence avant phase (miroir SQL ALREADY_APPLIED).
  if (scored.includes(String(roundId))) {
    return {
      ok: true,
      alreadyApplied: true,
      roundId,
      roundIndex: s.roundIndex,
      phase: s.phase,
    };
  }
  if (s.phase === "series_end") {
    return { ok: false, code: "TNS_SERIES_ENDED", stale: true };
  }
  if (s.phase !== "ranking" && !force) {
    return { ok: false, code: "TNS_INVALID_PHASE", stale: true, phase: s.phase };
  }
  return {
    ok: true,
    roundId,
    roundIndex: s.roundIndex,
    phase: s.phase,
    isLast: isTierNightSeriesLastRound(s),
  };
}

export function assertCanAdvanceTierNightSeriesRound({ runId, series } = {}) {
  if (!runId || !series) {
    return { ok: false, code: "TNS_NO_SERIES", validation: true };
  }
  const validation = validateTierNightSeries(series, { runId });
  if (!validation.ok) {
    return { ok: false, code: validation.code, validation: true };
  }
  const s = validation.series;
  if (s.phase === "series_end") {
    return { ok: false, code: "TNS_SERIES_ENDED", stale: true, noNextRound: true };
  }
  // Aligné SQL : advance n’accepte que between_rounds.
  if (!canAdvanceTierNightSeriesFromPhase(s.phase)) {
    return {
      ok: false,
      code: isRetiredTierNightSeriesPhase(s.phase)
        ? "TNS_PHASE_RETIRED"
        : "TNS_INVALID_PHASE",
      stale: s.phase === "ranking",
      phase: s.phase,
      retired: isRetiredTierNightSeriesPhase(s.phase),
    };
  }
  if (isTierNightSeriesLastRound(s)) {
    return { ok: false, code: "TNS_NO_NEXT_ROUND", noNextRound: true };
  }
  const active = getActiveTierNightSeriesRound(s);
  if (!active.ok) {
    return { ok: false, code: active.code, validation: true };
  }
  const roundId = active.round.roundId;
  const scored = Array.isArray(s.scoredRoundIds) ? s.scoredRoundIds : [];
  const completed = Array.isArray(s.completedRoundIds) ? s.completedRoundIds : [];
  if (!scored.includes(roundId) || !completed.includes(roundId)) {
    return { ok: false, code: "TNS_ROUND_NOT_SCORED", validation: true };
  }
  return {
    ok: true,
    currentRoundId: roundId,
    currentRoundIndex: s.roundIndex,
    phase: s.phase,
  };
}

/**
 * Matrice clear/preserve après advance (contrat produit).
 */
export const TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY = Object.freeze({
  clear: Object.freeze([
    "placements",
    "finished",
    "roundRecap",
    "local recap / UI in-flight",
  ]),
  preserve: Object.freeze([
    "runId",
    "series.queue",
    "series.roundHistory",
    "series.scoredRoundIds",
    "series.completedRoundIds",
    "playerRoster",
    "scores / gameScores",
    "consumedCustomRosterTopicIds",
  ]),
});

/**
 * Contrat history / recap (D1).
 * - roundHistory : ledger cumulatif autoritatif (jamais clear à advance)
 * - roundRecap : projection dernière manche terminée (clear à advance)
 */
export const TIER_NIGHT_SERIES_HISTORY_RECAP_CONTRACT = Object.freeze({
  roundHistory: "authoritative_cumulative_ledger",
  roundRecap: "last_completed_round_projection",
  advanceClearsRoundRecap: true,
  advancePreservesRoundHistory: true,
});

function canHostSeriesCommit() {
  if (!isGameSyncActive()) return true;
  return isLobbyHost() || canActAsHost();
}

/**
 * Navigue selon la phase série (après finalize/advance/hydrate).
 */
export function navigateForTierNightSeriesPhase(phase, { navStack } = {}) {
  const screen = resolveTierNightSeriesScreenFromPhase(phase);
  if (!screen) return false;
  // Pas de clear customs ici : frontière = sortie menu / change mode / replay.
  const stack =
    navStack ||
    (screen === "tiernight-end"
      ? ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep", "tiernight", "tiernight-end"]
      : screen === "tiernight-between"
        ? [
            "home",
            "lobby",
            "game-select",
            "tiernight-select",
            "tiernight-prep",
            "tiernight",
            "tiernight-between",
          ]
        : ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep", "tiernight"]);
  navigate(screen, { navStack: stack });
  return true;
}

/**
 * Applique l’état session renvoyé par la RPC (sans attendre Realtime).
 * Ne recalcule aucun score : copie l’état autoritatif.
 *
 * @param {object|null|undefined} rpcState — result.state
 * @param {{
 *   runId: string,
 *   expectScoredRoundId?: string|null,
 *   expectRoundIndex?: number|null,
 *   expectPhase?: string|null,
 * }} guards
 */
export function applyAuthoritativeSeriesRpcState(rpcState, guards = {}) {
  const { runId, expectScoredRoundId = null, expectRoundIndex = null, expectPhase = null } =
    guards;
  if (!rpcState || typeof rpcState !== "object") {
    return { ok: false, code: "TNS_EMPTY_STATE" };
  }
  const tn = rpcState.tierNight;
  if (!tn || typeof tn !== "object") {
    return { ok: false, code: "TNS_NO_TIERNIGHT" };
  }
  if (String(tn.runId || "") !== String(runId || "")) {
    return { ok: false, code: "TNS_STALE_RUN", stale: true };
  }
  const series = tn.series;
  if (!series || typeof series !== "object") {
    return { ok: false, code: "TNS_NO_SERIES" };
  }
  if (expectScoredRoundId != null) {
    const scored = Array.isArray(series.scoredRoundIds)
      ? series.scoredRoundIds.map(String)
      : [];
    if (!scored.includes(String(expectScoredRoundId))) {
      return { ok: false, code: "TNS_NOT_SCORED", stale: true };
    }
  }
  if (expectRoundIndex != null && Number(series.roundIndex) !== Number(expectRoundIndex)) {
    return { ok: false, code: "TNS_STALE_ROUND_INDEX", stale: true };
  }
  if (expectPhase != null && series.phase !== expectPhase) {
    // Après finalize, phase between|series_end ; tolérer si ledger déjà OK.
    if (expectScoredRoundId == null) {
      return { ok: false, code: "TNS_INVALID_PHASE", stale: true, phase: series.phase };
    }
  }

  applySeriesRowToLocal({ state: rpcState });
  if (rpcState.scores && typeof rpcState.scores === "object") {
    applyRemoteLobbyScores(rpcState.scores);
  }
  const patch = {};
  if (rpcState.playerStats && typeof rpcState.playerStats === "object") {
    patch.playerStats = rpcState.playerStats;
  }
  if (rpcState.gameScores && typeof rpcState.gameScores === "object") {
    patch.gameScores = rpcState.gameScores;
  }
  if (rpcState.stats && typeof rpcState.stats === "object") {
    patch.stats = rpcState.stats;
  }
  if (Object.keys(patch).length) saveStatePatch(patch);
  return { ok: true, phase: series.phase, series, appliedLocal: true };
}

async function reconcileSeriesFromServer({
  runId,
  roundId,
  expectScored = false,
  expectAdvancedIndex = null,
}) {
  const row = await refreshGameSession();
  const tn = row?.state?.tierNight;
  const series = tn?.series;
  if (!series || String(tn?.runId || "") !== String(runId || "")) {
    return { ok: false, code: "TNS_STALE_RUN", stale: true };
  }
  const match = doesTierNightSeriesEventMatch({
    currentRunId: runId,
    currentSeries: series,
    incomingRunId: runId,
    incomingRoundId: roundId,
    incomingRoundIndex: series.roundIndex,
    incomingPhase: series.phase,
  });
  if (expectAdvancedIndex != null) {
    if (
      Number(series.roundIndex) === Number(expectAdvancedIndex) &&
      series.phase === "ranking"
    ) {
      return { ok: true, reconciled: true, phase: series.phase, series, row };
    }
    return { ok: false, code: "TNS_NOT_ADVANCED", phase: series.phase };
  }
  if (expectScored) {
    const scored = Array.isArray(series.scoredRoundIds)
      ? series.scoredRoundIds.map(String)
      : [];
    if (scored.includes(String(roundId))) {
      return { ok: true, reconciled: true, phase: series.phase, series, row };
    }
    return { ok: false, code: "TNS_NOT_SCORED", phase: series.phase };
  }
  if (!match.ok && match.code === "ROUND_ID_MISMATCH" && series.phase === "ranking") {
    return { ok: true, reconciled: true, phase: series.phase, series, row, advanced: true };
  }
  return { ok: match.ok, code: match.code, phase: series.phase, series, row };
}

/** Rang de phase pour anti-régression soft-refresh (plus haut = plus avancé). */
function seriesPhaseRank(phase) {
  if (phase === "ranking") return 1;
  if (phase === "between_rounds") return 2;
  if (phase === "series_end") return 3;
  return 0;
}

/**
 * Un refresh stale ne doit jamais écraser un apply RPC plus avancé (cas F terrain).
 * @param {object|null|undefined} localTn — tierNightGame local
 * @param {object|null|undefined} remoteTn — row.state.tierNight
 */
export function shouldPreferLocalSeriesOverSoftRefresh(localTn, remoteTn) {
  if (!localTn?.series || !remoteTn?.series) return false;
  if (String(localTn.runId || "") !== String(remoteTn.runId || "")) return false;
  const localPhase = localTn.series.phase;
  const remotePhase = remoteTn.series.phase;
  if (seriesPhaseRank(localPhase) > seriesPhaseRank(remotePhase)) return true;
  const localScored = Array.isArray(localTn.series.scoredRoundIds)
    ? localTn.series.scoredRoundIds.length
    : 0;
  const remoteScored = Array.isArray(remoteTn.series.scoredRoundIds)
    ? remoteTn.series.scoredRoundIds.length
    : 0;
  if (localScored > remoteScored) return true;
  const localHist = Array.isArray(localTn.series.roundHistory)
    ? localTn.series.roundHistory.length
    : 0;
  const remoteHist = Array.isArray(remoteTn.series.roundHistory)
    ? remoteTn.series.roundHistory.length
    : 0;
  if (localHist > remoteHist) return true;
  return false;
}

/**
 * Soft-refresh : applique le row serveur sauf s’il régresse l’apply local du même run.
 * Exporté pour tests de symétrie anti-régression.
 * @param {object|null|undefined} row — game_sessions row
 * @returns {{ ok: true, applied: boolean, skippedStale?: boolean }}
 */
export function applySoftRefreshSeriesRowIfNotRegression(row) {
  const remoteTn = row?.state?.tierNight;
  if (!remoteTn) return { ok: true, applied: false };
  const localTn = getState().tierNightGame;
  if (shouldPreferLocalSeriesOverSoftRefresh(localTn, remoteTn)) {
    return { ok: true, applied: false, skippedStale: true };
  }
  applySeriesRowToLocal(row);
  return { ok: true, applied: true };
}

/**
 * Best-effort refresh après apply local. Échec ≠ rollback.
 * N’applique pas un row qui régresserait phase / ledgers locaux.
 */
async function softRefreshAfterLocalApply() {
  try {
    const row = await refreshGameSession();
    return { ...applySoftRefreshSeriesRowIfNotRegression(row), row };
  } catch {
    return { ok: false, refreshFailed: true };
  }
}

/**
 * Phase de navigation post-finalize (après soft refresh anti-régression).
 */
export function resolvePostFinalizeNavigationPhase({
  localApply = null,
  resPhase = null,
  isLast = false,
  series = null,
} = {}) {
  const fromState = series?.phase;
  if (fromState === "series_end" || fromState === "between_rounds") return fromState;
  if (localApply?.ok && localApply.phase) return localApply.phase;
  if (resPhase === "series_end" || resPhase === "between_rounds") return resPhase;
  return isLast ? "series_end" : "between_rounds";
}

/**
 * Hôte : finalize manche série (RPC) + application locale immédiate + navigation.
 *
 * force=true : CTA hôte explicite « Voir les résultats » — SQL score
 * roster ∩ finished=true ∩ placement valide uniquement (déterministe).
 * Sans force : finalize seulement si tous les membres roster sont finished
 * (barrière client) ; SQL refuse sinon TNS_PLACEMENTS_INCOMPLETE.
 */
export async function hostFinalizeTierNightSeriesRound({
  force = false,
  shouldContinue = null,
} = {}) {
  const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();

  if (!canHostSeriesCommit()) {
    return { ok: false, unauthorized: true, code: "TNS_UNAUTHORIZED" };
  }

  const outcome = await finalizeLock.run(async () => {
    const { runId, series } = getSeriesContext();
    const guard = assertCanFinalizeTierNightSeriesRound({ runId, series, force });
    if (!guard.ok) return guard;
    if (guard.alreadyApplied) {
      if (canContinue()) navigateForTierNightSeriesPhase(guard.phase || series.phase);
      return { ok: true, applied: false, code: "ALREADY_APPLIED", phase: guard.phase };
    }

    if (!force && isGameSyncActive() && !allTierNightMembersFinished()) {
      return {
        ok: false,
        code: "TNS_PLACEMENTS_INCOMPLETE",
        validation: true,
        incomplete: true,
      };
    }

    if (!isGameSyncActive()) {
      return { ok: false, code: "TNS_LOCAL_SERIES_UNSUPPORTED", validation: true };
    }

    const transitionId = buildTierNightSeriesTransitionId("finalize", {
      runId,
      roundId: guard.roundId,
      phase: "ranking",
    });
    finalizeTransitionId = transitionId;

    const lobbyId = getLobbyId();
    const res = await commitTierNightSeriesRoundResult({
      lobbyId,
      runId,
      roundId: guard.roundId,
      roundIndex: guard.roundIndex,
      expectedPhase: "ranking",
      force,
    });

    // Callback stale : autre manche / autre run déjà en cours côté local.
    if (finalizeTransitionId !== transitionId) {
      return { ok: false, code: "TNS_STALE_CALLBACK", stale: true };
    }

    if (res.timeout) {
      const rec = await reconcileSeriesFromServer({
        runId,
        roundId: guard.roundId,
        expectScored: true,
      });
      if (rec.ok) {
        applySeriesRowToLocal(rec.row);
        if (rec.row?.state?.scores) applyRemoteLobbyScores(rec.row.state.scores);
        if (canContinue()) navigateForTierNightSeriesPhase(rec.phase);
        return {
          ok: true,
          applied: false,
          reconciled: true,
          phase: rec.phase,
          timeout: true,
        };
      }
      return { ...res, reconcileFailed: true, ux: mapTierNightSeriesRpcErrorToUx(res.code) };
    }

    if (!res.ok) {
      return { ...res, ux: mapTierNightSeriesRpcErrorToUx(res.code) };
    }

    // 1) Apply immédiat depuis payload RPC (Realtime non requis).
    const localApply = applyAuthoritativeSeriesRpcState(res.result?.state, {
      runId,
      expectScoredRoundId: guard.roundId,
    });

    // 2) Soft refresh confirme ; échec / stale ne rollback pas l’apply RPC.
    await softRefreshAfterLocalApply();

    const phase = resolvePostFinalizeNavigationPhase({
      localApply,
      resPhase: res.phase,
      isLast: guard.isLast,
      series: getState().tierNightGame?.series,
    });

    if (canContinue()) navigateForTierNightSeriesPhase(phase);
    return {
      ...res,
      phase,
      appliedLocal: localApply.ok === true,
      transitionId,
    };
  });

  if (outcome.skipped) return { ok: false, skipped: true, code: "TNS_IN_FLIGHT" };
  return outcome.value;
}

/**
 * Hôte : avance between → ranking suivante.
 */
export async function hostAdvanceTierNightSeriesRound({ shouldContinue = null } = {}) {
  const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();

  if (!canHostSeriesCommit()) {
    return { ok: false, unauthorized: true, code: "TNS_UNAUTHORIZED" };
  }

  const outcome = await advanceLock.run(async () => {
    const { runId, series } = getSeriesContext();
    const guard = assertCanAdvanceTierNightSeriesRound({ runId, series });
    if (!guard.ok) {
      return { ...guard, ux: mapTierNightSeriesRpcErrorToUx(guard.code, "advance") };
    }

    if (!isGameSyncActive()) {
      return { ok: false, code: "TNS_LOCAL_SERIES_UNSUPPORTED", validation: true };
    }

    const nextIndex = guard.currentRoundIndex + 1;
    const transitionId = buildTierNightSeriesTransitionId("advance", {
      runId,
      roundId: guard.currentRoundId,
      phase: "between_rounds",
    });
    advanceTransitionId = transitionId;

    const lobbyId = getLobbyId();
    const res = await commitTierNightSeriesNextRound({
      lobbyId,
      runId,
      currentRoundId: guard.currentRoundId,
      currentRoundIndex: guard.currentRoundIndex,
      expectedPhase: "between_rounds",
    });

    if (advanceTransitionId !== transitionId) {
      return { ok: false, code: "TNS_STALE_CALLBACK", stale: true };
    }

    if (res.timeout) {
      const rec = await reconcileSeriesFromServer({
        runId,
        roundId: guard.currentRoundId,
        expectAdvancedIndex: nextIndex,
      });
      if (rec.ok) {
        applySeriesRowToLocal(rec.row);
        if (canContinue()) navigateForTierNightSeriesPhase("ranking");
        return {
          ok: true,
          applied: false,
          reconciled: true,
          phase: "ranking",
          timeout: true,
        };
      }
      return {
        ...res,
        reconcileFailed: true,
        ux: mapTierNightSeriesRpcErrorToUx(res.code, "advance"),
      };
    }

    if (!res.ok) {
      return { ...res, ux: mapTierNightSeriesRpcErrorToUx(res.code, "advance") };
    }

    const localApply = applyAuthoritativeSeriesRpcState(res.result?.state, {
      runId,
      expectRoundIndex: nextIndex,
      expectPhase: "ranking",
    });
    await softRefreshAfterLocalApply();

    if (canContinue()) navigateForTierNightSeriesPhase("ranking");
    return {
      ...res,
      phase: res.phase || "ranking",
      appliedLocal: localApply.ok === true,
      transitionId,
    };
  });

  if (outcome.skipped) return { ok: false, skipped: true, code: "TNS_IN_FLIGHT" };
  return outcome.value;
}

function applySeriesRowToLocal(row) {
  const tn = row?.state?.tierNight;
  if (!tn) return;
  const local = getState().tierNightGame || {};
  const series = tn.series;
  const patch = {
    tierNightGame: {
      ...local,
      runId: tn.runId ?? local.runId,
      topicId: tn.topicId ?? local.topicId,
      listName: tn.listName ?? local.listName,
      topicEmoji: tn.topicEmoji ?? local.topicEmoji,
      items: Array.isArray(tn.items) && tn.items.length ? tn.items : local.items,
      playerRoster:
        Array.isArray(tn.playerRoster) && tn.playerRoster.length
          ? tn.playerRoster
          : local.playerRoster,
      lobbyStarted: tn.lobbyStarted,
      series: series && typeof series === "object" ? { ...series } : local.series,
      // Clear / sync placements & finished depuis remote (advance)
      placements:
        tn.placements && typeof tn.placements === "object" ? tn.placements : local.placements,
      finished: tn.finished && typeof tn.finished === "object" ? tn.finished : local.finished,
    },
  };
  // Bridge legacy dernière manche OU projection roundRecap (between / end).
  const roundRecap =
    series?.roundRecap && typeof series.roundRecap === "object" ? series.roundRecap : null;
  if (tn.recap && typeof tn.recap === "object") {
    patch.tierNightGame = {
      ...patch.tierNightGame,
      ...tn.recap,
      recapSynced: true,
    };
  } else if (roundRecap) {
    const snap = roundRecap.topicSnapshot && typeof roundRecap.topicSnapshot === "object"
      ? roundRecap.topicSnapshot
      : null;
    patch.tierNightGame = {
      ...patch.tierNightGame,
      topicId: roundRecap.topicId ?? patch.tierNightGame.topicId,
      listName: snap?.name || patch.tierNightGame.listName || "",
      topicEmoji: snap?.emoji || patch.tierNightGame.topicEmoji || "",
      consensus: roundRecap.consensus ?? patch.tierNightGame.consensus ?? null,
      controversialItem:
        roundRecap.controversialItem !== undefined
          ? roundRecap.controversialItem
          : patch.tierNightGame.controversialItem ?? null,
      controversialSpread:
        roundRecap.controversialSpread !== undefined
          ? roundRecap.controversialSpread
          : patch.tierNightGame.controversialSpread ?? 0,
      recaps: Array.isArray(roundRecap.recaps) ? roundRecap.recaps : patch.tierNightGame.recaps,
      recapSynced: true,
    };
  }
  if (tn.topicId) {
    patch.tierNightTopicId = tn.topicId;
  }
  saveStatePatch(patch);
}

/**
 * Invité / sync : suivre la phase après mutation distante.
 */
export function followTierNightSeriesPhaseFromRow(row, { shouldContinue = null } = {}) {
  const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();
  const phase = row?.state?.tierNight?.series?.phase;
  const screen = resolveTierNightSeriesScreenFromPhase(phase);
  if (!screen || !canContinue()) return false;
  navigateForTierNightSeriesPhase(phase);
  return true;
}
