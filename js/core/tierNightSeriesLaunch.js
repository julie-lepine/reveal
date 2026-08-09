/**
 * FEATURE-TIERNIGHT-SERIES-04 - préparation / payload de lancement série (pur, testable).
 *
 * Pas d’import gameSync / lobby / Supabase : les callers injectent le roster.
 * Ordre : runId final → queue → series → payload.
 */

import { createTierNightRunId } from "./tierNightConfig.js";
import { buildTierNightPlayerRoster } from "./tierNightRoster.js";
import {
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  validateTierNightSeries,
  withTierNightSeriesRemote,
} from "./tierNightSeries.js";
import { resolveTierNightSeriesSetupCategoryIds } from "./tierNightSeriesSetup.js";

/**
 * Prépare runId + queue **une fois**. Réutiliser `attempt` après timeout (pas de nouveau RNG).
 *
 * @param {object} opts
 * @param {string[]|null} opts.categoryIds
 * @param {number} opts.roundCount
 * @param {string} [opts.modifier="normal"]
 * @param {() => number} [opts.rng]
 * @param {Array<{ userId?: string, name?: string }>} opts.participants - requis (fige le roster)
 * @param {Iterable<object>} [opts.customTopics] - customs lobby (FEATURE-TIERNIGHT-03-A)
 * @param {Iterable<string>|null} [opts.excludeCustomIds] - customs one-shot déjà consommés
 */
export function prepareTierNightSeriesLaunchAttempt({
  categoryIds,
  roundCount,
  modifier = "normal",
  rng,
  participants,
  customTopics = [],
  excludeCustomIds = null,
} = {}) {
  if (!Array.isArray(participants)) {
    return {
      ok: false,
      code: "MISSING_PARTICIPANTS",
      error: "Participants requis pour figer le roster (hôte uniquement).",
    };
  }

  const runId = createTierNightRunId();
  const playerRoster = buildTierNightPlayerRoster(participants);
  if (!playerRoster.length) {
    return {
      ok: false,
      code: "EMPTY_ROSTER",
      error: "Aucun joueur dans le lobby pour figer le roster.",
    };
  }

  const cats = resolveTierNightSeriesSetupCategoryIds(categoryIds);
  const queueOpts = {
    runId,
    categoryIds: cats,
    roundCount,
    customTopics,
    excludeCustomIds,
  };
  if (typeof rng === "function") queueOpts.rng = rng;

  const queueRes = buildTierNightSeriesQueue(queueOpts);
  if (!queueRes.ok) {
    const msg =
      queueRes.code === "INSUFFICIENT_TOPICS"
        ? `Pas assez de thèmes (${queueRes.available ?? 0}) pour ${roundCount} manches.`
        : queueRes.message || "Impossible de construire la queue.";
    return {
      ok: false,
      code: queueRes.code,
      error: msg,
      available: queueRes.available,
      requested: queueRes.requested,
    };
  }

  const seriesRes = createTierNightSeriesState({
    runId,
    categoryIds: cats,
    roundCount,
    queue: queueRes.queue,
  });
  if (!seriesRes.ok) {
    return {
      ok: false,
      code: seriesRes.code || "INVALID_SERIES",
      error: seriesRes.message || "Série invalide.",
    };
  }

  const entry0 = queueRes.queue[0];
  const snap = entry0?.topicSnapshot || {};
  const items = playerRoster.map((p) => p.displayName);

  return {
    ok: true,
    attempt: {
      runId,
      series: seriesRes.series,
      queue: queueRes.queue,
      playerRoster,
      items,
      topicId: entry0.topicId,
      listName: String(snap.name || ""),
      topicEmoji: String(snap.emoji || "👥"),
      mode: "roster",
      modifier: modifier || "normal",
      categoryIds: seriesRes.series.categoryIds,
      roundCount: seriesRes.series.roundCount,
      consumedCustomTopicIds: queueRes.consumedCustomTopicIds || [],
    },
  };
}

/**
 * Construit local game + blob remote à partir d’une tentative validée.
 * Sérialisation série via SERIES-02 (`withTierNightSeriesRemote`) - sans gameSync.
 * @param {object} attempt
 */
export function buildTierNightSeriesLaunchPayload(attempt) {
  if (!attempt?.runId || !attempt?.series || !attempt?.topicId) {
    return { ok: false, code: "INVALID_ATTEMPT", error: "Tentative invalide." };
  }
  const validation = validateTierNightSeries(attempt.series, {
    runId: attempt.runId,
  });
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      error: validation.message || "Série invalide.",
    };
  }

  const series = validation.series;
  const mode = "roster";
  const modifier = attempt.modifier || "normal";
  const items = Array.isArray(attempt.items) ? [...attempt.items] : [];
  const playerRoster = Array.isArray(attempt.playerRoster)
    ? attempt.playerRoster.map((p) => ({ ...p }))
    : [];

  if (!items.length || !playerRoster.length) {
    return { ok: false, code: "EMPTY_ROSTER", error: "Roster ou items manquants." };
  }

  const localGame = {
    runId: attempt.runId,
    recaps: [],
    topicId: attempt.topicId,
    listName: attempt.listName || "",
    topicEmoji: attempt.topicEmoji || "👥",
    controversialItem: null,
    items,
    playerRoster,
    series,
  };

  // Miroir pur de tierNightToRemote (placements/finished vides au lancement).
  const remoteBase = {
    runId: attempt.runId,
    topicId: attempt.topicId,
    mode,
    modifier,
    lobbyStarted: true,
    game: true,
    items,
    playerRoster,
    listName: localGame.listName,
    topicEmoji: localGame.topicEmoji,
    placements: {},
    finished: {},
    recap: null,
  };

  const remoteTierNight = withTierNightSeriesRemote(remoteBase, series, {
    runId: attempt.runId,
  });

  if (!remoteTierNight?.series) {
    return {
      ok: false,
      code: "SERIES_SERIALIZE_FAILED",
      error: "La série n'a pas pu être sérialisée pour la session.",
    };
  }

  return {
    ok: true,
    mode,
    modifier,
    topicId: attempt.topicId,
    localGame,
    remoteTierNight,
  };
}
