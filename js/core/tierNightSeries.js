/**
 * FEATURE-TIERNIGHT-SERIES-01 — contrat de série « Classe le groupe » (helpers purs).
 *
 * Option A : runId = instance globale de série ; roundId = `${runId}:${roundIndex}`.
 * Aucun DOM, aucun Supabase, aucun state global.
 */

import {
  TIER_NIGHT_ROSTER_CATEGORIES,
  TIER_NIGHT_ROSTER_TOPICS,
} from "../../data/tierTopics.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "./customRosterTopics.js";
import { ROSTER_TOPIC_PREFIX } from "./rosterTopic.js";
import { sessionHasTierNightPlayerRoster } from "./tierNightRoster.js";

export const TIER_NIGHT_SERIES_VERSION = 1;

/** Sentinel : toutes les catégories enabled du catalogue. */
export const TIER_NIGHT_SERIES_ALL_CATEGORIES = "*";

export const TIER_NIGHT_SERIES_ROUND_COUNTS = Object.freeze([3, 5, 7]);

export const TIER_NIGHT_SERIES_PHASES = Object.freeze([
  "ranking",
  "round_result",
  "between_rounds",
  "series_end",
]);

/**
 * @param {string} runId
 * @param {number} roundIndex
 */
export function buildTierNightSeriesRoundId(runId, roundIndex) {
  const run = String(runId ?? "").trim();
  const idx = Number(roundIndex);
  if (!run || !Number.isInteger(idx) || idx < 0) return "";
  return `${run}:${idx}`;
}

function defaultRng() {
  return Math.random();
}

function isAllCategoriesSelection(categoryIds) {
  if (categoryIds == null) return true;
  if (!Array.isArray(categoryIds)) return false;
  if (categoryIds.length === 0) return true;
  return categoryIds.some((id) => String(id) === TIER_NIGHT_SERIES_ALL_CATEGORIES);
}

function normalizeCategoryIdSet(categoryIds) {
  if (isAllCategoriesSelection(categoryIds)) return null;
  const set = new Set();
  for (const id of categoryIds) {
    const s = String(id ?? "").trim();
    if (s && s !== TIER_NIGHT_SERIES_ALL_CATEGORIES) set.add(s);
  }
  return set;
}

/**
 * Thème catalogue éligible pour une queue de série V1 (pas custom, enabled).
 * @param {unknown} topic
 */
export function isTierNightSeriesCatalogTopicEligible(topic) {
  if (!topic || typeof topic !== "object") return false;
  const id = topic.id != null ? String(topic.id).trim() : "";
  if (!id) return false;
  if (id.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX)) return false;
  if (topic.custom === true) return false;
  if (topic.enabled === false) return false;
  return true;
}

/**
 * @param {object} [opts]
 * @param {Iterable<object>} [opts.topics]
 * @param {string[]|null} [opts.categoryIds] — `null` / `["*"]` / `[]` = toutes
 * @param {boolean} [opts.enabledOnly=true]
 * @param {boolean} [opts.excludeCustom=true]
 */
export function listEligibleTierNightSeriesTopics({
  topics = TIER_NIGHT_ROSTER_TOPICS,
  categoryIds = null,
  enabledOnly = true,
  excludeCustom = true,
} = {}) {
  const catSet = normalizeCategoryIdSet(categoryIds);
  const out = [];
  for (const topic of topics || []) {
    if (!topic || typeof topic !== "object") continue;
    const id = topic.id != null ? String(topic.id).trim() : "";
    if (!id) continue;
    if (excludeCustom) {
      if (topic.custom === true || id.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX)) continue;
    }
    if (enabledOnly && topic.enabled === false) continue;
    if (catSet) {
      const cid = topic.categoryId != null ? String(topic.categoryId) : "";
      if (!catSet.has(cid)) continue;
    }
    out.push(topic);
  }
  return out;
}

/**
 * Compte les thèmes disponibles pour un lancement série.
 */
export function countEligibleTierNightSeriesTopics(opts = {}) {
  return listEligibleTierNightSeriesTopics(opts).length;
}

/**
 * Snapshot sérialisable d’un thème catalogue (pas de fonctions).
 * @param {object} topic
 */
export function snapshotTierNightSeriesTopic(topic) {
  if (!topic || typeof topic !== "object") return null;
  const id = topic.id != null ? String(topic.id).trim() : "";
  if (!id) return null;
  return {
    id,
    name: String(topic.name ?? "").trim(),
    emoji: topic.emoji != null ? String(topic.emoji) : "",
    categoryId: topic.categoryId != null ? String(topic.categoryId) : "",
  };
}

function fisherYatesShuffle(items, rng) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const u = typeof rng === "function" ? rng() : defaultRng();
    const j = Math.floor(Math.max(0, Math.min(0.999999999, Number(u) || 0)) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Construit la queue ordonnée d’une série (une seule fois au lancement).
 *
 * @param {object} opts
 * @param {string} opts.runId
 * @param {Iterable<object>} [opts.topics]
 * @param {string[]|null} [opts.categoryIds]
 * @param {number} opts.roundCount — 3 | 5 | 7
 * @param {() => number} [opts.rng]
 * @returns {{ ok: true, queue: object[] } | { ok: false, code: string, requested?: number, available?: number, message?: string }}
 */
export function buildTierNightSeriesQueue({
  runId,
  topics = TIER_NIGHT_ROSTER_TOPICS,
  categoryIds = null,
  roundCount,
  rng = defaultRng,
} = {}) {
  const run = String(runId ?? "").trim();
  if (!run) {
    return { ok: false, code: "INVALID_RUN_ID", message: "runId requis." };
  }

  const count = Number(roundCount);
  if (!TIER_NIGHT_SERIES_ROUND_COUNTS.includes(count)) {
    return {
      ok: false,
      code: "INVALID_ROUND_COUNT",
      requested: count,
      message: "roundCount doit être 3, 5 ou 7.",
    };
  }

  const eligible = listEligibleTierNightSeriesTopics({
    topics,
    categoryIds,
    enabledOnly: true,
    excludeCustom: true,
  });

  if (eligible.length < count) {
    return {
      ok: false,
      code: "INSUFFICIENT_TOPICS",
      requested: count,
      available: eligible.length,
    };
  }

  const picked = fisherYatesShuffle(eligible, rng).slice(0, count);
  const queue = picked.map((topic, roundIndex) => {
    const snap = snapshotTierNightSeriesTopic(topic);
    return {
      roundId: buildTierNightSeriesRoundId(run, roundIndex),
      roundIndex,
      topicId: `${ROSTER_TOPIC_PREFIX}${snap.id}`,
      topicSnapshot: snap,
    };
  });

  return { ok: true, queue };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function ledgerToIdSet(ledger) {
  if (Array.isArray(ledger)) {
    return new Set(ledger.map((id) => String(id)));
  }
  if (ledger && typeof ledger === "object") {
    return new Set(
      Object.entries(ledger)
        .filter(([, v]) => Boolean(v))
        .map(([k]) => String(k))
    );
  }
  return new Set();
}

function ledgerToArray(ledger) {
  return [...ledgerToIdSet(ledger)];
}

/**
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string[]|null} opts.categoryIds
 * @param {number} opts.roundCount
 * @param {object[]} opts.queue
 */
export function createTierNightSeriesState({
  runId,
  categoryIds = null,
  roundCount,
  queue,
} = {}) {
  const run = String(runId ?? "").trim();
  if (!run) {
    return { ok: false, code: "INVALID_RUN_ID", message: "runId requis." };
  }

  const normalizedCats = isAllCategoriesSelection(categoryIds)
    ? [TIER_NIGHT_SERIES_ALL_CATEGORIES]
    : (Array.isArray(categoryIds) ? categoryIds.map((c) => String(c)) : []);

  const series = {
    version: TIER_NIGHT_SERIES_VERSION,
    categoryIds: normalizedCats,
    roundCount: Number(roundCount),
    queue: Array.isArray(queue) ? cloneJson(queue) : [],
    roundIndex: 0,
    phase: "ranking",
    scoredRoundIds: [],
    completedRoundIds: [],
  };

  const validation = validateTierNightSeries(series, { runId: run });
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message, details: validation };
  }

  return { ok: true, series: validation.series };
}

/**
 * @param {unknown} series
 */
export function getActiveTierNightSeriesRound(series) {
  if (!series || typeof series !== "object") {
    return { ok: false, code: "NO_SERIES", round: null };
  }
  const queue = Array.isArray(series.queue) ? series.queue : null;
  if (!queue) return { ok: false, code: "INVALID_QUEUE", round: null };
  const idx = Number(series.roundIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= queue.length) {
    return { ok: false, code: "ROUND_INDEX_OUT_OF_BOUNDS", round: null };
  }
  const round = queue[idx];
  if (!round || typeof round !== "object") {
    return { ok: false, code: "MISSING_ROUND", round: null };
  }
  return { ok: true, round: cloneJson(round) };
}

/**
 * @param {unknown} series
 */
export function getTierNightSeriesProgress(series) {
  if (!series || typeof series !== "object") {
    return { ok: false, code: "NO_SERIES" };
  }
  const roundCount = Number(series.roundCount);
  const roundIndex = Number(series.roundIndex);
  const active = getActiveTierNightSeriesRound(series);
  return {
    ok: true,
    roundIndex: Number.isInteger(roundIndex) ? roundIndex : null,
    roundCount: Number.isInteger(roundCount) ? roundCount : null,
    phase: typeof series.phase === "string" ? series.phase : null,
    isLastRound: isTierNightSeriesLastRound(series),
    activeRound: active.ok ? active.round : null,
    scoredRoundIds: ledgerToArray(series.scoredRoundIds),
    completedRoundIds: ledgerToArray(series.completedRoundIds),
  };
}

/**
 * @param {unknown} series
 */
export function isTierNightSeriesLastRound(series) {
  if (!series || typeof series !== "object") return false;
  const roundCount = Number(series.roundCount);
  const roundIndex = Number(series.roundIndex);
  if (!Number.isInteger(roundCount) || roundCount < 1) return false;
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return false;
  return roundIndex >= roundCount - 1;
}

/**
 * Normalise / classe un payload série.
 * - absent → legacy mono-thème
 * - valide → series
 * - invalide → invalid (pas de correction silencieuse métier)
 *
 * @param {unknown} rawSeries
 * @param {{ runId?: string|null }} [opts]
 */
export function normalizeTierNightSeries(rawSeries, opts = {}) {
  if (rawSeries == null) {
    return { kind: "legacy", series: null };
  }
  if (typeof rawSeries !== "object") {
    return { kind: "invalid", code: "NOT_OBJECT", series: null };
  }
  const validation = validateTierNightSeries(rawSeries, opts);
  if (!validation.ok) {
    return {
      kind: "invalid",
      code: validation.code,
      message: validation.message,
      series: null,
    };
  }
  return { kind: "series", series: validation.series };
}

/**
 * @param {unknown} series
 * @param {{ runId?: string|null, allowUnknownLedgerIds?: boolean }} [opts]
 */
export function validateTierNightSeries(series, opts = {}) {
  if (series == null) {
    return { ok: false, code: "ABSENT", message: "Série absente (legacy)." };
  }
  if (typeof series !== "object") {
    return { ok: false, code: "NOT_OBJECT", message: "Série non objet." };
  }

  const version = Number(series.version);
  if (version !== TIER_NIGHT_SERIES_VERSION) {
    return { ok: false, code: "UNKNOWN_VERSION", message: `version=${series.version}` };
  }

  const phase = series.phase;
  if (!TIER_NIGHT_SERIES_PHASES.includes(phase)) {
    return { ok: false, code: "UNKNOWN_PHASE", message: `phase=${phase}` };
  }

  const roundCount = Number(series.roundCount);
  if (!TIER_NIGHT_SERIES_ROUND_COUNTS.includes(roundCount)) {
    return { ok: false, code: "INVALID_ROUND_COUNT", message: `roundCount=${series.roundCount}` };
  }

  if (!Array.isArray(series.queue)) {
    return { ok: false, code: "INVALID_QUEUE", message: "queue manquante." };
  }
  if (series.queue.length !== roundCount) {
    return {
      ok: false,
      code: "QUEUE_LENGTH_MISMATCH",
      message: `queue.length=${series.queue.length} roundCount=${roundCount}`,
    };
  }

  const roundIndex = Number(series.roundIndex);
  if (!Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex >= roundCount) {
    return { ok: false, code: "ROUND_INDEX_OUT_OF_BOUNDS", message: `roundIndex=${series.roundIndex}` };
  }

  const runId = opts.runId != null ? String(opts.runId).trim() : null;
  const roundIds = new Set();
  const topicIds = new Set();

  for (let i = 0; i < series.queue.length; i += 1) {
    const entry = series.queue[i];
    if (!entry || typeof entry !== "object") {
      return { ok: false, code: "INVALID_QUEUE_ENTRY", message: `index ${i}` };
    }
    const entryIndex = Number(entry.roundIndex);
    if (entryIndex !== i) {
      return {
        ok: false,
        code: "ROUND_INDEX_DISCONTINUITY",
        message: `attendu ${i}, reçu ${entry.roundIndex}`,
      };
    }
    const roundId = entry.roundId != null ? String(entry.roundId) : "";
    if (!roundId) {
      return { ok: false, code: "MISSING_ROUND_ID", message: `index ${i}` };
    }
    if (roundIds.has(roundId)) {
      return { ok: false, code: "DUPLICATE_ROUND_ID", message: roundId };
    }
    roundIds.add(roundId);

    if (runId) {
      const expected = buildTierNightSeriesRoundId(runId, i);
      if (roundId !== expected) {
        return {
          ok: false,
          code: "ROUND_ID_MISMATCH",
          message: `attendu ${expected}, reçu ${roundId}`,
        };
      }
    }

    const topicId = entry.topicId != null ? String(entry.topicId) : "";
    if (!topicId.startsWith(ROSTER_TOPIC_PREFIX)) {
      return { ok: false, code: "INVALID_TOPIC_ID", message: topicId };
    }
    const rawId = topicId.slice(ROSTER_TOPIC_PREFIX.length);
    if (rawId.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX) || entry.topicSnapshot?.custom === true) {
      return { ok: false, code: "CUSTOM_IN_SERIES_QUEUE", message: topicId };
    }
    if (topicIds.has(topicId)) {
      return { ok: false, code: "DUPLICATE_TOPIC_ID", message: topicId };
    }
    topicIds.add(topicId);

    const snap = entry.topicSnapshot;
    if (!snap || typeof snap !== "object") {
      return { ok: false, code: "INCOMPLETE_SNAPSHOT", message: `index ${i}` };
    }
    if (!String(snap.id || "").trim() || !String(snap.name || "").trim()) {
      return { ok: false, code: "INCOMPLETE_SNAPSHOT", message: `index ${i} id/name` };
    }
    if (String(snap.id) !== rawId) {
      return {
        ok: false,
        code: "SNAPSHOT_ID_MISMATCH",
        message: `topicId ${rawId} vs snapshot ${snap.id}`,
      };
    }
  }

  for (const ledgerKey of ["scoredRoundIds", "completedRoundIds"]) {
    const ids = ledgerToIdSet(series[ledgerKey]);
    for (const id of ids) {
      if (!roundIds.has(id)) {
        return {
          ok: false,
          code: "LEDGER_UNKNOWN_ROUND_ID",
          message: `${ledgerKey}:${id}`,
        };
      }
    }
  }

  if (!Array.isArray(series.categoryIds)) {
    return { ok: false, code: "INVALID_CATEGORY_IDS", message: "categoryIds" };
  }

  const normalized = {
    version: TIER_NIGHT_SERIES_VERSION,
    categoryIds: series.categoryIds.map((c) => String(c)),
    roundCount,
    queue: cloneJson(series.queue),
    roundIndex,
    phase,
    scoredRoundIds: ledgerToArray(series.scoredRoundIds),
    completedRoundIds: ledgerToArray(series.completedRoundIds),
  };

  return { ok: true, series: normalized };
}

/**
 * Garde stale pour événements / patches série.
 *
 * @param {object} opts
 */
export function doesTierNightSeriesEventMatch({
  currentRunId,
  currentSeries,
  incomingRunId,
  incomingRoundId = null,
  incomingRoundIndex = null,
  incomingPhase = null,
} = {}) {
  const curRun = currentRunId != null ? String(currentRunId).trim() : "";
  const incRun = incomingRunId != null ? String(incomingRunId).trim() : "";
  if (!curRun || !incRun || curRun !== incRun) {
    return { ok: false, code: "RUN_ID_MISMATCH" };
  }

  const norm = normalizeTierNightSeries(currentSeries, { runId: curRun });
  if (norm.kind !== "series") {
    return { ok: false, code: "NO_CURRENT_SERIES" };
  }
  const series = norm.series;

  if (incomingPhase != null) {
    const phase = String(incomingPhase);
    if (!TIER_NIGHT_SERIES_PHASES.includes(phase)) {
      return { ok: false, code: "UNKNOWN_PHASE" };
    }
  }

  if (incomingRoundIndex != null) {
    const idx = Number(incomingRoundIndex);
    if (!Number.isInteger(idx)) {
      return { ok: false, code: "INVALID_ROUND_INDEX" };
    }
    if (idx < series.roundIndex) {
      return { ok: false, code: "STALE_ROUND_INDEX" };
    }
    if (idx > series.roundIndex) {
      return { ok: false, code: "FUTURE_ROUND_INDEX" };
    }
  }

  if (incomingRoundId != null) {
    const rid = String(incomingRoundId);
    const active = getActiveTierNightSeriesRound(series);
    if (!active.ok || active.round.roundId !== rid) {
      // Même index mais mauvais roundId, ou roundId d’une autre manche
      const known = series.queue.some((e) => e.roundId === rid);
      if (!known) return { ok: false, code: "UNKNOWN_ROUND_ID" };
      if (!active.ok || active.round.roundId !== rid) {
        return { ok: false, code: "ROUND_ID_MISMATCH" };
      }
    }
  }

  if (incomingPhase != null) {
    const phase = String(incomingPhase);
    // Phase d’une manche future non commitée : entre rounds alors qu’on est encore ranking
    // sur un index inférieur — déjà couvert par roundIndex. Ici : phase series_end alors
    // qu’on n’est pas sur la dernière manche active côté courant.
    if (phase === "series_end" && !isTierNightSeriesLastRound(series) && series.phase !== "series_end") {
      return { ok: false, code: "PREMATURE_SERIES_END" };
    }
  }

  return { ok: true };
}

/**
 * Progression pure between_rounds → ranking (manche suivante).
 * Ne mute pas l’entrée ; ne génère pas de nouveau roundId.
 *
 * @param {object} opts
 */
export function computeNextTierNightRoundState({
  runId,
  series,
  placements = null,
  finished = null,
} = {}) {
  const run = String(runId ?? "").trim();
  if (!run) {
    return { ok: false, code: "INVALID_RUN_ID" };
  }

  const validation = validateTierNightSeries(series, { runId: run });
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }
  const current = validation.series;

  if (current.phase !== "between_rounds") {
    return { ok: false, code: "INVALID_PHASE", phase: current.phase };
  }
  if (isTierNightSeriesLastRound(current)) {
    return { ok: false, code: "LAST_ROUND" };
  }

  const nextIndex = current.roundIndex + 1;
  const nextEntry = current.queue[nextIndex];
  if (!nextEntry) {
    return { ok: false, code: "MISSING_NEXT_ROUND" };
  }

  const nextSeries = {
    ...cloneJson(current),
    roundIndex: nextIndex,
    phase: "ranking",
  };

  return {
    ok: true,
    runId: run,
    series: nextSeries,
    activeRound: cloneJson(nextEntry),
    topicId: nextEntry.topicId,
    listName: nextEntry.topicSnapshot?.name || "",
    topicEmoji: nextEntry.topicSnapshot?.emoji || "",
    clearPlacements: true,
    clearFinished: true,
    clearRoundRecap: true,
    // Références entrantes exposées pour les tickets suivants (non mutées)
    previousPlacements: placements,
    previousFinished: finished,
  };
}

/**
 * Invariant : roster figé pour toute la série (lecture pure).
 * @param {object|null|undefined} session — tierNightGame / remote tierNight
 */
export function isTierNightSeriesRosterFrozen(session) {
  return sessionHasTierNightPlayerRoster(session);
}

/**
 * Une série ne doit jamais reconstruire les items depuis le live lobby.
 * @param {object|null|undefined} session
 * @returns {{ ok: boolean, code?: string }}
 */
export function assertTierNightSeriesUsesFrozenRoster(session) {
  if (!isTierNightSeriesRosterFrozen(session)) {
    return { ok: false, code: "MISSING_PLAYER_ROSTER" };
  }
  if (!Array.isArray(session.items) || session.items.length === 0) {
    return { ok: false, code: "MISSING_ITEMS_SNAPSHOT" };
  }
  return { ok: true };
}

/**
 * Compare deux snapshots roster (immutabilité entre manches).
 */
export function didTierNightSeriesRosterChange(prevRoster, nextRoster) {
  const a = JSON.stringify(prevRoster ?? null);
  const b = JSON.stringify(nextRoster ?? null);
  return a !== b;
}

export function listTierNightRosterCategories() {
  return TIER_NIGHT_ROSTER_CATEGORIES.map((c) => ({ ...c }));
}

/* -------------------------------------------------------------------------- */
/* SERIES-02 — sérialisation / hydratation / merge (purs)                     */
/* -------------------------------------------------------------------------- */

/**
 * Attache une série validée à un blob `tierNight` remote (pur).
 * N’ajoute la clé `series` que si la validation réussit.
 *
 * @param {object} remoteBase
 * @param {unknown} series
 * @param {{ runId?: string|null }} [opts]
 */
export function withTierNightSeriesRemote(remoteBase, series, opts = {}) {
  const remote =
    remoteBase && typeof remoteBase === "object" ? { ...remoteBase } : {};
  delete remote.series;
  delete remote.__seriesMergeDiagnostic;
  if (series === undefined || series == null) return remote;
  const wired = tierNightSeriesToRemote(series, {
    runId: opts.runId ?? remote.runId ?? null,
  });
  if (wired.ok) remote.series = wired.series;
  return remote;
}

/**
 * Sérialise une série valide pour `game_sessions.state.tierNight.series`.
 * @param {unknown} series
 * @param {{ runId?: string|null }} [opts]
 * @returns {{ ok: true, series: object } | { ok: false, code: string, message?: string }}
 */
export function tierNightSeriesToRemote(series, opts = {}) {
  const validation = validateTierNightSeries(series, opts);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code || "INVALID_SERIES",
      message: validation.message,
    };
  }
  return { ok: true, series: cloneJson(validation.series) };
}

/**
 * Hydrate depuis un payload remote.
 * @param {unknown} rawSeries
 * @param {{ runId?: string|null }} [opts]
 * @returns {{ kind: "legacy"|"series"|"invalid", series: object|null, code?: string, message?: string }}
 */
export function hydrateTierNightSeriesFromRemote(rawSeries, opts = {}) {
  if (rawSeries == null) {
    return { kind: "legacy", series: null };
  }
  return normalizeTierNightSeries(rawSeries, opts);
}

/**
 * Empreinte immuable de queue (ordre + roundId + topicId + snapshot).
 * @param {unknown} series
 */
export function tierNightSeriesQueueFingerprint(series) {
  if (!series || !Array.isArray(series.queue)) return "";
  return JSON.stringify(
    series.queue.map((e) => ({
      roundId: e?.roundId ?? null,
      roundIndex: e?.roundIndex ?? null,
      topicId: e?.topicId ?? null,
      topicSnapshot: e?.topicSnapshot ?? null,
    }))
  );
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
export function doTierNightSeriesQueuesMatch(a, b) {
  const fa = tierNightSeriesQueueFingerprint(a);
  const fb = tierNightSeriesQueueFingerprint(b);
  return Boolean(fa) && fa === fb;
}

/**
 * Invariant thème actif ↔ entrée de queue.
 * @param {object} opts
 */
export function assertTierNightSeriesActiveTopicInvariant({
  topicId = null,
  listName = null,
  topicEmoji = null,
  series = null,
  runId = null,
  requireMeta = false,
} = {}) {
  const norm = normalizeTierNightSeries(series, { runId });
  if (norm.kind === "legacy") {
    return { ok: true, kind: "legacy" };
  }
  if (norm.kind !== "series") {
    return { ok: false, code: norm.code || "INVALID_SERIES", kind: "invalid" };
  }
  const active = getActiveTierNightSeriesRound(norm.series);
  if (!active.ok) {
    return { ok: false, code: active.code, kind: "invalid" };
  }
  const expectedTopic = active.round.topicId;
  if (topicId != null && String(topicId) !== String(expectedTopic)) {
    return {
      ok: false,
      code: "ACTIVE_TOPIC_MISMATCH",
      kind: "invalid",
      expectedTopicId: expectedTopic,
      topicId: String(topicId),
    };
  }
  const snap = active.round.topicSnapshot || {};
  if (requireMeta || listName != null) {
    if (listName != null && String(listName) !== String(snap.name || "")) {
      return {
        ok: false,
        code: "ACTIVE_LISTNAME_MISMATCH",
        kind: "invalid",
        expected: snap.name,
        listName: String(listName),
      };
    }
  }
  if (requireMeta || topicEmoji != null) {
    const expectedEmoji = snap.emoji != null ? String(snap.emoji) : "";
    if (topicEmoji != null && String(topicEmoji) !== expectedEmoji) {
      return {
        ok: false,
        code: "ACTIVE_EMOJI_MISMATCH",
        kind: "invalid",
        expected: expectedEmoji,
        topicEmoji: String(topicEmoji),
      };
    }
  }
  const expectedRoundId = active.round.roundId;
  return {
    ok: true,
    kind: "series",
    expectedTopicId: expectedTopic,
    expectedRoundId,
    expectedListName: snap.name || "",
    expectedTopicEmoji: snap.emoji != null ? String(snap.emoji) : "",
  };
}

/**
 * Décide comment appliquer une série distante (full row ou champ nested).
 *
 * @param {object} opts
 * @param {unknown} opts.remoteSeries - valeur brute ; `undefined` si clé absente
 * @param {boolean} opts.remoteHasSeriesKey
 * @param {string|null} opts.remoteRunId
 * @param {unknown} opts.localSeries
 * @param {string|null} opts.localRunId
 * @param {string|null} [opts.remoteTopicId]
 * @param {string|null} [opts.remoteListName]
 * @param {string|null} [opts.remoteTopicEmoji]
 * @param {"full"|"patch"} [opts.source="full"]
 *   - full : absence de clé = legacy (clear)
 *   - patch : absence de clé = préserver local
 */
export function resolveTierNightSeriesMerge({
  remoteSeries,
  remoteHasSeriesKey = false,
  remoteRunId = null,
  localSeries = null,
  localRunId = null,
  remoteTopicId = null,
  remoteListName = null,
  remoteTopicEmoji = null,
  source = "full",
} = {}) {
  const localNorm = normalizeTierNightSeries(localSeries, { runId: localRunId });
  const sameRun =
    localRunId &&
    remoteRunId &&
    String(localRunId) === String(remoteRunId);

  if (!remoteHasSeriesKey) {
    if (source === "patch") {
      return {
        action: "preserve_local",
        series: localNorm.kind === "series" ? localNorm.series : null,
        kind: localNorm.kind === "series" ? "series" : "legacy",
      };
    }
    // Full remote sans série = mono-thème / reset explicite
    return { action: "clear", series: null, kind: "legacy" };
  }

  if (remoteSeries == null) {
    // Clé présente à null → clear explicite
    return { action: "clear", series: null, kind: "legacy" };
  }

  const remoteHydrated = hydrateTierNightSeriesFromRemote(remoteSeries, {
    runId: remoteRunId,
  });

  if (remoteHydrated.kind === "invalid") {
    if (sameRun && localNorm.kind === "series") {
      return {
        action: "keep_local_reject_remote",
        series: localNorm.series,
        kind: "series",
        diagnostic: {
          code: remoteHydrated.code,
          message: remoteHydrated.message,
        },
      };
    }
    return {
      action: "reject_invalid",
      series: null,
      kind: "invalid",
      diagnostic: {
        code: remoteHydrated.code,
        message: remoteHydrated.message,
      },
    };
  }

  if (remoteHydrated.kind !== "series") {
    return { action: "clear", series: null, kind: "legacy" };
  }

  const topicCheck = assertTierNightSeriesActiveTopicInvariant({
    topicId: remoteTopicId,
    listName: remoteListName,
    topicEmoji: remoteTopicEmoji,
    series: remoteHydrated.series,
    runId: remoteRunId,
    requireMeta: false,
  });
  if (!topicCheck.ok && remoteTopicId != null) {
    if (sameRun && localNorm.kind === "series") {
      return {
        action: "keep_local_reject_remote",
        series: localNorm.series,
        kind: "series",
        diagnostic: { code: topicCheck.code },
      };
    }
    return {
      action: "reject_invalid",
      series: null,
      kind: "invalid",
      diagnostic: { code: topicCheck.code },
    };
  }

  if (sameRun && localNorm.kind === "series") {
    if (!doTierNightSeriesQueuesMatch(localNorm.series, remoteHydrated.series)) {
      return {
        action: "keep_local_reject_remote",
        series: localNorm.series,
        kind: "series",
        diagnostic: { code: "QUEUE_DIVERGENCE_SAME_RUN" },
      };
    }
  }

  return {
    action: "apply_remote",
    series: remoteHydrated.series,
    kind: "series",
  };
}

/**
 * Merge shallow de l’objet `tierNight` en préservant / validant `series`.
 * @param {object|null|undefined} currentTn
 * @param {object|null|undefined} incomingTn
 * @param {{ source?: "full"|"patch" }} [opts]
 */
export function mergeTierNightRemoteBlob(currentTn, incomingTn, opts = {}) {
  const source = opts.source === "full" ? "full" : "patch";
  const current = currentTn && typeof currentTn === "object" ? currentTn : {};
  const incoming = incomingTn && typeof incomingTn === "object" ? incomingTn : {};
  const merged = { ...current, ...incoming };

  const remoteHasSeriesKey = Object.prototype.hasOwnProperty.call(incoming, "series");
  const decision = resolveTierNightSeriesMerge({
    remoteSeries: remoteHasSeriesKey ? incoming.series : undefined,
    remoteHasSeriesKey,
    remoteRunId: merged.runId ?? null,
    localSeries: current.series ?? null,
    localRunId: current.runId ?? null,
    remoteTopicId: Object.prototype.hasOwnProperty.call(incoming, "topicId")
      ? incoming.topicId
      : merged.topicId,
    remoteListName: Object.prototype.hasOwnProperty.call(incoming, "listName")
      ? incoming.listName
      : null,
    remoteTopicEmoji: Object.prototype.hasOwnProperty.call(incoming, "topicEmoji")
      ? incoming.topicEmoji
      : null,
    source,
  });

  if (decision.action === "clear" || decision.series == null) {
    delete merged.series;
  } else {
    merged.series = cloneJson(decision.series);
  }

  if (
    decision.action === "keep_local_reject_remote" ||
    decision.action === "reject_invalid"
  ) {
    merged.__seriesMergeDiagnostic = decision.diagnostic || {
      code: decision.action,
    };
  } else if (merged.__seriesMergeDiagnostic) {
    delete merged.__seriesMergeDiagnostic;
  }

  return { tierNight: merged, decision };
}

/**
 * Applique le résultat de merge série sur un objet `tierNightGame` local.
 * @param {object} localGame
 * @param {ReturnType<typeof resolveTierNightSeriesMerge>} decision
 */
export function applySeriesDecisionToTierNightGame(localGame, decision) {
  const base =
    localGame && typeof localGame === "object" ? { ...localGame } : {};
  if (!decision || decision.action === "clear" || decision.series == null) {
    delete base.series;
    if (base.seriesMergeDiagnostic) delete base.seriesMergeDiagnostic;
    return base;
  }
  base.series = cloneJson(decision.series);
  if (
    decision.action === "keep_local_reject_remote" ||
    decision.action === "reject_invalid"
  ) {
    base.seriesMergeDiagnostic = decision.diagnostic || { code: decision.action };
  } else if (base.seriesMergeDiagnostic) {
    delete base.seriesMergeDiagnostic;
  }
  return base;
}
