/**
 * FEATURE-TIERNIGHT-SERIES-01 / FEATURE-TIERNIGHT-03-A / 03-A1 — contrat série (helpers purs).
 *
 * Option A : runId = identité globale de la série ; roundId = `${runId}:${roundIndex}`.
 * Aucun DOM, aucun Supabase, aucun state global.
 *
 * FEATURE-TIERNIGHT-03-A / BUG-TIERNIGHT-SERIES-QA-01 :
 * - nouvelles séries : roundCount ∈ {3,5,8}
 * - roundCount 7 : lecture défensive legacy uniquement (plus de build)
 * - customs lobby éligibles + snapshotés ; one-shot via excludeCustomIds
 * - queue : priorité custom (même logique REVEAL combinedGameDeck), puis shuffle du sous-ensemble
 *
 * FEATURE-TIERNIGHT-03-A1 — one-shot (cycle de vie) :
 * - Consommation = id custom présent dans `series.queue` au **lancement** (snapshot).
 * - `customRosterTopics` (lobby) n’est **pas** muté par le moteur (pas de delete auto).
 * - Prochaine série : passer `excludeCustomIds` (= union des consommés lobby) pour
 *   ne pas re-tirer les mêmes customs.
 * - Pendant la série active : le texte joué vient uniquement du snapshot queue ;
 *   supprimer un custom du lobby ne casse pas la manche.
 * - Persistance multi-client de `excludeCustomIds` = evening state (étape B+).
 */

import {
  TIER_NIGHT_ROSTER_CATEGORIES,
  TIER_NIGHT_ROSTER_TOPICS,
} from "../../data/tierTopics.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "./customRosterTopics.js";
import { ROSTER_TOPIC_PREFIX } from "./rosterTopic.js";
import { sessionHasTierNightPlayerRoster } from "./tierNightRoster.js";
import { buildCombinedShuffledDeck } from "./combinedGameDeck.js";

export const TIER_NIGHT_SERIES_VERSION = 1;

/** Sentinel : toutes les catégories enabled du catalogue. */
export const TIER_NIGHT_SERIES_ALL_CATEGORIES = "*";

/** Counts autorisés pour toute nouvelle série (FEATURE-TIERNIGHT-03). */
export const TIER_NIGHT_SERIES_ROUND_COUNTS = Object.freeze([3, 5, 8]);

/**
 * Counts acceptés en lecture seule (sessions déjà lancées avant 03-A).
 * Ne jamais proposer à l’UI de lancement.
 */
export const TIER_NIGHT_SERIES_LEGACY_ROUND_COUNTS = Object.freeze([7]);

export const TIER_NIGHT_SERIES_PHASES = Object.freeze([
  "ranking",
  "between_rounds",
  "series_end",
]);

/**
 * Phase prévue dans SERIES-00, jamais écrite par finalize/advance.
 * Rejetée par le validateur D1-bis (Option A) — pas d’état jouable.
 */
export const TIER_NIGHT_SERIES_RETIRED_PHASES = Object.freeze(["round_result"]);

/** @param {string|null|undefined} phase */
export function isRetiredTierNightSeriesPhase(phase) {
  return TIER_NIGHT_SERIES_RETIRED_PHASES.includes(String(phase || ""));
}

/**
 * Contrat one-shot customs (preuve / docs runtime).
 * @type {Readonly<{
 *   scope: string,
 *   consumeOn: string,
 *   excludeParam: string,
 *   mutatesLobbyCustoms: boolean,
 *   snapshotSurvivesLobbyDelete: boolean,
 *   persistEvening: string
 * }>}
 */
export const TIER_NIGHT_SERIES_ONE_SHOT_CONTRACT = Object.freeze({
  scope: "lobby_lifetime",
  consumeOn: "series_launch_queue_membership",
  excludeParam: "excludeCustomIds",
  mutatesLobbyCustoms: false,
  snapshotSurvivesLobbyDelete: true,
  persistEvening: "pending_step_b",
});

/**
 * Codes shape SQL 03-A1 (preuve de contrat — alignés sur
 * `tiernight_series_validate_series_shape`).
 */
export const TIER_NIGHT_SERIES_SQL_SHAPE_CODES = Object.freeze([
  "TNS_NO_SERIES",
  "TNS_UNSUPPORTED_VERSION",
  "TNS_UNKNOWN_PHASE",
  "TNS_INVALID_ROUND_COUNT",
  "TNS_INVALID_CATEGORY_IDS",
  "TNS_INVALID_QUEUE",
  "TNS_QUEUE_LENGTH_MISMATCH",
  "TNS_ROUND_INDEX_OUT_OF_BOUNDS",
  "TNS_INVALID_RUN_ID",
  "TNS_INVALID_QUEUE_ENTRY",
  "TNS_ROUND_INDEX_DISCONTINUITY",
  "TNS_MISSING_ROUND_ID",
  "TNS_DUPLICATE_ROUND_ID",
  "TNS_ROUND_ID_MISMATCH",
  "TNS_INVALID_TOPIC_ID",
  "TNS_DUPLICATE_TOPIC_ID",
  "TNS_INCOMPLETE_SNAPSHOT",
  "TNS_SNAPSHOT_ID_TYPE",
  "TNS_SNAPSHOT_NAME_TYPE",
  "TNS_SNAPSHOT_ID_MISMATCH",
  "TNS_CUSTOM_FLAG_INVALID",
  "TNS_CUSTOM_SNAPSHOT_INCONSISTENT",
  "TNS_LEDGER_NOT_ARRAY",
  "TNS_LEDGER_INVALID_ENTRY",
  "TNS_LEDGER_DUPLICATE",
  "TNS_LEDGER_UNKNOWN_ROUND_ID",
  "TNS_LEDGER_SCORED_NOT_COMPLETED",
  "TNS_HISTORY_NOT_ARRAY",
  "TNS_HISTORY_INVALID_ENTRY",
  "TNS_HISTORY_UNKNOWN_ROUND",
  "TNS_HISTORY_DUPLICATE",
  "TNS_SHAPE_EXCEPTION",
]);

function isValidSeriesRoundCount(roundCount, { allowLegacy = false } = {}) {
  const n = Number(roundCount);
  if (TIER_NIGHT_SERIES_ROUND_COUNTS.includes(n)) return true;
  if (allowLegacy && TIER_NIGHT_SERIES_LEGACY_ROUND_COUNTS.includes(n)) return true;
  return false;
}

function isCustomRosterTopicId(id) {
  const s = id != null ? String(id).trim() : "";
  return Boolean(s) && s.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX);
}

/** Aligné SQL A1-bis : bool | "true"|"t"|"false"|"f". */
function parseCustomSnapshotFlag(value) {
  if (value === true) return { ok: true, custom: true };
  if (value === false) return { ok: true, custom: false };
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "t") return { ok: true, custom: true };
    if (s === "false" || s === "f") return { ok: true, custom: false };
    return { ok: false, code: "CUSTOM_FLAG_INVALID", message: s };
  }
  return { ok: false, code: "CUSTOM_FLAG_INVALID", message: typeof value };
}

/**
 * Contrat categoryIds (aligné SQL A1-bis) — forme seule.
 * @param {unknown} categoryIds
 * @returns {{ ok: true, categoryIds: string[] } | { ok: false, code: string, message?: string }}
 */
export function validateTierNightSeriesCategoryIdsShape(categoryIds) {
  if (!Array.isArray(categoryIds)) {
    return { ok: false, code: "INVALID_CATEGORY_IDS", message: "not_array" };
  }
  if (categoryIds.length === 0) {
    return { ok: false, code: "INVALID_CATEGORY_IDS", message: "empty" };
  }
  const seen = new Set();
  const normalized = [];
  let hasStar = false;
  let hasExplicit = false;
  for (const raw of categoryIds) {
    if (typeof raw !== "string") {
      return { ok: false, code: "INVALID_CATEGORY_IDS", message: "non_string" };
    }
    const s = raw.trim();
    if (!s) {
      return { ok: false, code: "INVALID_CATEGORY_IDS", message: "blank" };
    }
    if (seen.has(s)) {
      return { ok: false, code: "INVALID_CATEGORY_IDS", message: "duplicate" };
    }
    seen.add(s);
    normalized.push(s);
    if (s === TIER_NIGHT_SERIES_ALL_CATEGORIES) hasStar = true;
    else hasExplicit = true;
  }
  if (hasStar && hasExplicit) {
    return { ok: false, code: "INVALID_CATEGORY_IDS", message: "star_mixed" };
  }
  if (hasStar && normalized.length !== 1) {
    return { ok: false, code: "INVALID_CATEGORY_IDS", message: "star_not_alone" };
  }
  return { ok: true, categoryIds: normalized };
}

/** Ids catégorie catalogue canonique (hors sentinel `*`). */
export function listKnownTierNightSeriesCategoryIds() {
  return TIER_NIGHT_ROSTER_CATEGORIES.map((c) => String(c.id));
}

/**
 * BUG-TIERNIGHT-SERIES-QA-01 — forme + appartenance catalogue JS.
 * `["*"]` reste le wildcard. Une catégorie inconnue est rejetée (pas de pool officiel vide silencieux).
 * Validation côté JS uniquement : le SQL série ne possède pas le registry catalogue.
 *
 * @param {unknown} categoryIds
 * @returns {{ ok: true, categoryIds: string[] } | { ok: false, code: string, message?: string }}
 */
export function validateTierNightSeriesCategoryIds(categoryIds) {
  const shape = validateTierNightSeriesCategoryIdsShape(categoryIds);
  if (!shape.ok) return shape;
  if (
    shape.categoryIds.length === 1 &&
    shape.categoryIds[0] === TIER_NIGHT_SERIES_ALL_CATEGORIES
  ) {
    return shape;
  }
  const known = new Set(listKnownTierNightSeriesCategoryIds());
  for (const id of shape.categoryIds) {
    if (!known.has(id)) {
      return {
        ok: false,
        code: "UNKNOWN_CATEGORY_ID",
        message: id,
      };
    }
  }
  return shape;
}

function validateLedgerStringArray(ledger, ledgerKey) {
  if (ledger == null) return { ok: true, ids: [] };
  if (!Array.isArray(ledger)) {
    return { ok: false, code: "LEDGER_NOT_ARRAY", message: ledgerKey };
  }
  const ids = [];
  const seen = new Set();
  for (const item of ledger) {
    if (typeof item !== "string") {
      return { ok: false, code: "LEDGER_INVALID_ENTRY", message: ledgerKey };
    }
    if (seen.has(item)) {
      return { ok: false, code: "LEDGER_DUPLICATE", message: ledgerKey };
    }
    seen.add(item);
    ids.push(item);
  }
  return { ok: true, ids };
}

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
 * Thème catalogue officiel éligible (pas custom, enabled).
 * @param {unknown} topic
 */
export function isTierNightSeriesCatalogTopicEligible(topic) {
  if (!topic || typeof topic !== "object") return false;
  const id = topic.id != null ? String(topic.id).trim() : "";
  if (!id) return false;
  if (isCustomRosterTopicId(id)) return false;
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
      if (topic.custom === true || isCustomRosterTopicId(id)) continue;
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
 * Compte les thèmes catalogue (hors customs lobby) pour un filtre catégorie.
 */
export function countEligibleTierNightSeriesTopics(opts = {}) {
  return listEligibleTierNightSeriesTopics(opts).length;
}

/**
 * Ids custom présents dans une queue de série déjà lancée (one-shot).
 * @param {object|null|undefined} series
 * @returns {string[]}
 */
export function listConsumedCustomTopicIdsFromSeries(series) {
  const queue = series && Array.isArray(series.queue) ? series.queue : [];
  const out = [];
  const seen = new Set();
  for (const entry of queue) {
    const snap = entry?.topicSnapshot;
    const id =
      snap?.id != null
        ? String(snap.id).trim()
        : entry?.topicId != null
          ? String(entry.topicId).replace(new RegExp(`^${ROSTER_TOPIC_PREFIX}`), "").trim()
          : "";
    if (!id) continue;
    const isCustom = snap?.custom === true || isCustomRosterTopicId(id);
    if (!isCustom || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Union ordonnée d’ids custom consommés (lobby lifetime, one-shot).
 * @param {Iterable<string>|null|undefined} previousIds
 * @param {object|null|undefined} series
 */
export function mergeConsumedCustomTopicIds(previousIds, series) {
  const seen = new Set();
  const out = [];
  for (const id of previousIds || []) {
    const s = id != null ? String(id).trim() : "";
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  for (const id of listConsumedCustomTopicIdsFromSeries(series)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Filtre les customs déjà consommés par une série antérieure du lobby.
 * @param {Iterable<object>|null|undefined} customTopics
 * @param {Iterable<string>|null|undefined} excludeCustomIds
 */
export function filterUnconsumedCustomTopics(customTopics, excludeCustomIds = null) {
  const exclude = new Set(
    [...(excludeCustomIds || [])].map((id) => String(id ?? "").trim()).filter(Boolean)
  );
  const out = [];
  const seen = new Set();
  for (const raw of customTopics || []) {
    if (!raw || typeof raw !== "object") continue;
    const id = raw.id != null ? String(raw.id).trim() : "";
    if (!isCustomRosterTopicId(id) || seen.has(id) || exclude.has(id)) continue;
    const name = String(raw.name ?? "").trim();
    if (!name) continue;
    seen.add(id);
    out.push({
      id,
      name,
      custom: true,
      emoji: "",
      categoryId: "",
      enabled: true,
      ...(raw.author != null ? { author: String(raw.author) } : {}),
      ...(raw.authorUid != null ? { authorUid: String(raw.authorUid) } : {}),
    });
  }
  return out;
}

/**
 * Pool série : officiels (filtre catégorie) ∪ customs lobby non consommés.
 * Dédup par `id`. Les customs ignorent le filtre catégorie.
 *
 * @param {object} [opts]
 * @param {Iterable<object>} [opts.topics]
 * @param {Iterable<object>} [opts.customTopics]
 * @param {string[]|null} [opts.categoryIds]
 * @param {Iterable<string>|null} [opts.excludeCustomIds]
 */
export function buildTierNightSeriesTopicPool({
  topics = TIER_NIGHT_ROSTER_TOPICS,
  customTopics = [],
  categoryIds = null,
  excludeCustomIds = null,
} = {}) {
  const official = listEligibleTierNightSeriesTopics({
    topics,
    categoryIds,
    enabledOnly: true,
    excludeCustom: true,
  });
  const customs = filterUnconsumedCustomTopics(customTopics, excludeCustomIds);
  const seen = new Set();
  const out = [];
  for (const topic of [...official, ...customs]) {
    const id = topic.id != null ? String(topic.id).trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(topic);
  }
  return out;
}

/**
 * Cardinalité du pool série (officiels + customs non consommés).
 */
export function countTierNightSeriesTopicPool(opts = {}) {
  return buildTierNightSeriesTopicPool(opts).length;
}

/**
 * Snapshot sérialisable (officiel ou custom). Pas de fonctions / auteur.
 * @param {object} topic
 */
export function snapshotTierNightSeriesTopic(topic) {
  if (!topic || typeof topic !== "object") return null;
  const id = topic.id != null ? String(topic.id).trim() : "";
  if (!id) return null;
  const custom = topic.custom === true || isCustomRosterTopicId(id);
  return {
    id,
    name: String(topic.name ?? "").trim(),
    emoji: custom ? "" : topic.emoji != null ? String(topic.emoji) : "",
    categoryId: custom ? "" : topic.categoryId != null ? String(topic.categoryId) : "",
    custom,
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
 * Snapshot figé — aucun reshuffle ultérieur côté helpers.
 *
 * BUG-TIERNIGHT-SERIES-QA-01 — priorité custom (pas de shuffle global pool→slice) :
 * - C = 0 → N officiels
 * - 0 < C < N → tous les customs + (N−C) officiels → shuffle du sous-ensemble
 * - C = N → N customs
 * - C > N → N customs tirés ; non tirés non consommés
 *
 * @param {object} opts
 * @param {string} opts.runId
 * @param {Iterable<object>} [opts.topics] — catalogue officiel
 * @param {Iterable<object>} [opts.customTopics] — customs lobby
 * @param {Iterable<string>|null} [opts.excludeCustomIds] — one-shot déjà consommés
 * @param {string[]|null} [opts.categoryIds]
 * @param {number} opts.roundCount — 3 | 5 | 8
 * @param {() => number} [opts.rng]
 * @returns {{ ok: true, queue: object[], consumedCustomTopicIds: string[] } | { ok: false, code: string, requested?: number, available?: number, message?: string }}
 */
export function buildTierNightSeriesQueue({
  runId,
  topics = TIER_NIGHT_ROSTER_TOPICS,
  customTopics = [],
  excludeCustomIds = null,
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
      message: "roundCount doit être 3, 5 ou 8.",
    };
  }

  if (categoryIds != null) {
    const cats = validateTierNightSeriesCategoryIds(
      Array.isArray(categoryIds) && categoryIds.length === 0
        ? [TIER_NIGHT_SERIES_ALL_CATEGORIES]
        : categoryIds
    );
    if (!cats.ok) {
      return {
        ok: false,
        code: cats.code,
        message: cats.message,
      };
    }
  }

  const officials = listEligibleTierNightSeriesTopics({
    topics,
    categoryIds,
    enabledOnly: true,
    excludeCustom: true,
  });
  const customs = filterUnconsumedCustomTopics(customTopics, excludeCustomIds);
  const available = officials.length + customs.length;

  if (available < count) {
    return {
      ok: false,
      code: "INSUFFICIENT_TOPICS",
      requested: count,
      available,
    };
  }

  // Même politique REVEAL que Dilemma / HotTake (combinedGameDeck).
  const picked = buildCombinedShuffledDeck(
    customs,
    officials,
    count,
    (requested) => Number(requested) || 0,
    typeof rng === "function" ? rng : defaultRng
  );

  if (!Array.isArray(picked) || picked.length !== count) {
    return {
      ok: false,
      code: "INSUFFICIENT_TOPICS",
      requested: count,
      available: Array.isArray(picked) ? picked.length : 0,
    };
  }

  const queue = picked.map((topic, roundIndex) => {
    const snap = snapshotTierNightSeriesTopic(topic);
    return {
      roundId: buildTierNightSeriesRoundId(run, roundIndex),
      roundIndex,
      topicId: `${ROSTER_TOPIC_PREFIX}${snap.id}`,
      topicSnapshot: snap,
    };
  });

  return {
    ok: true,
    queue,
    consumedCustomTopicIds: listConsumedCustomTopicIdsFromSeries({ queue }),
  };
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
  if (isRetiredTierNightSeriesPhase(phase)) {
    return {
      ok: false,
      code: "PHASE_RETIRED",
      message: `phase=${phase} (retirée D1-bis Option A)`,
    };
  }
  if (!TIER_NIGHT_SERIES_PHASES.includes(phase)) {
    return { ok: false, code: "UNKNOWN_PHASE", message: `phase=${phase}` };
  }

  const roundCount = Number(series.roundCount);
  // 7 accepté en lecture défensive (SERIES legacy) ; nouveaux builds = 3/5/8 uniquement.
  if (!isValidSeriesRoundCount(roundCount, { allowLegacy: true })) {
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
    if (topicIds.has(topicId)) {
      return { ok: false, code: "DUPLICATE_TOPIC_ID", message: topicId };
    }
    topicIds.add(topicId);

    const snap = entry.topicSnapshot;
    if (!snap || typeof snap !== "object" || Array.isArray(snap)) {
      return { ok: false, code: "INCOMPLETE_SNAPSHOT", message: `index ${i}` };
    }

    if (!Object.prototype.hasOwnProperty.call(snap, "id") || snap.id == null) {
      return { ok: false, code: "INCOMPLETE_SNAPSHOT", message: `index ${i} id_missing` };
    }
    if (typeof snap.id !== "string") {
      return { ok: false, code: "SNAPSHOT_ID_TYPE", message: `index ${i}` };
    }
    if (!Object.prototype.hasOwnProperty.call(snap, "name") || snap.name == null) {
      return { ok: false, code: "INCOMPLETE_SNAPSHOT", message: `index ${i} name_missing` };
    }
    if (typeof snap.name !== "string") {
      return { ok: false, code: "SNAPSHOT_NAME_TYPE", message: `index ${i}` };
    }
    const snapId = snap.id.trim();
    const snapName = snap.name.trim();
    if (!snapId || !snapName) {
      return { ok: false, code: "INCOMPLETE_SNAPSHOT", message: `index ${i} id/name` };
    }
    if (snapId !== rawId) {
      return {
        ok: false,
        code: "SNAPSHOT_ID_MISMATCH",
        message: `topicId ${rawId} vs snapshot ${snap.id}`,
      };
    }

    // FEATURE-TIERNIGHT-03-A1-bis : custom absent ≠ null ; chaînes arbitraires rejetées.
    const wireCustom = isCustomRosterTopicId(rawId);
    const hasCustomKey = Object.prototype.hasOwnProperty.call(snap, "custom");
    if (!hasCustomKey) {
      if (wireCustom) {
        return {
          ok: false,
          code: "CUSTOM_SNAPSHOT_INCONSISTENT",
          message: topicId,
        };
      }
    } else if (snap.custom === null) {
      return {
        ok: false,
        code: "CUSTOM_FLAG_INVALID",
        message: "null",
      };
    } else {
      const parsed = parseCustomSnapshotFlag(snap.custom);
      if (!parsed.ok) {
        return {
          ok: false,
          code: parsed.code,
          message: parsed.message || topicId,
        };
      }
      if (wireCustom !== parsed.custom) {
        return {
          ok: false,
          code: "CUSTOM_SNAPSHOT_INCONSISTENT",
          message: topicId,
        };
      }
    }
  }

  for (const ledgerKey of ["scoredRoundIds", "completedRoundIds"]) {
    const ledgerRes = validateLedgerStringArray(series[ledgerKey], ledgerKey);
    if (!ledgerRes.ok) {
      return {
        ok: false,
        code: ledgerRes.code,
        message: ledgerRes.message,
      };
    }
    for (const id of ledgerRes.ids) {
      if (!roundIds.has(id)) {
        return {
          ok: false,
          code: "LEDGER_UNKNOWN_ROUND_ID",
          message: `${ledgerKey}:${id}`,
        };
      }
    }
  }

  const scoredRes = validateLedgerStringArray(series.scoredRoundIds, "scoredRoundIds");
  const completedRes = validateLedgerStringArray(series.completedRoundIds, "completedRoundIds");
  if (scoredRes.ok && completedRes.ok) {
    const completedSet = new Set(completedRes.ids);
    for (const id of scoredRes.ids) {
      if (!completedSet.has(id)) {
        return {
          ok: false,
          code: "LEDGER_SCORED_NOT_COMPLETED",
          message: id,
        };
      }
    }
  }

  const catsRes = validateTierNightSeriesCategoryIdsShape(series.categoryIds);
  if (!catsRes.ok) {
    return { ok: false, code: catsRes.code, message: catsRes.message };
  }

  const normalized = {
    version: TIER_NIGHT_SERIES_VERSION,
    categoryIds: catsRes.categoryIds,
    roundCount,
    queue: cloneJson(series.queue),
    roundIndex,
    phase,
    scoredRoundIds: scoredRes.ok ? scoredRes.ids : ledgerToArray(series.scoredRoundIds),
    completedRoundIds: completedRes.ok ? completedRes.ids : ledgerToArray(series.completedRoundIds),
  };
  // FEATURE-TIERNIGHT-03-D — conserver history/recap (finalize/between/advance).
  if (Array.isArray(series.roundHistory)) {
    normalized.roundHistory = cloneJson(series.roundHistory);
  }
  if (series.roundRecap && typeof series.roundRecap === "object" && !Array.isArray(series.roundRecap)) {
    normalized.roundRecap = cloneJson(series.roundRecap);
  }

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
