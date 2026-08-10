/**
 * FEATURE-TIERNIGHT-04B - domaine pur Rank Live série (counts, pool officiel, builder).
 *
 * Sélectionne un SOUS-ENSEMBLE de listes pour une future queue (04E).
 * Ne crée pas runId / roundId / series wire / state / Supabase.
 *
 * Réutilise `buildCombinedShuffledDeck` TEL QUEL (décision A/B : wrapper live, pas de
 * modification de `combinedGameDeck.js`).
 *
 * Catégories Rank Live : registry JS `TIER_NIGHT_LIVE_CATEGORIES` + `categoryId` sur
 * `TIER_LISTS` — pas de catalogue SQL.
 */

import {
  TIER_LISTS,
  TIER_NIGHT_LIVE_CATEGORIES,
} from "../../data/tierTopics.js";
import { buildCombinedShuffledDeck } from "./combinedGameDeck.js";
import { validateCustomLiveTierListsForBuild } from "./customLiveTierLists.js";

/** Counts autorisés pour une NOUVELLE série Rank Live (aligné roster 3/5/8). */
export const TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS = Object.freeze([3, 5, 8]);

/**
 * Counts acceptés en lecture seule (séries déjà lancées avant le contrat 3/5/8).
 * Ne jamais proposer à l’UI de lancement ni au builder.
 */
export const TIER_NIGHT_LIVE_SERIES_LEGACY_ROUND_COUNTS = Object.freeze([7]);

export const DEFAULT_TIER_NIGHT_LIVE_SERIES_ROUND_COUNT = 5;

/** Sentinelle wildcard catalogue officiel complet (+ customs au pool). */
export const TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES = "*";

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidTierNightLiveRoundCount(value) {
  return TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS.includes(value);
}

/**
 * Nouveau launch + séries legacy encore jouables.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isReadableTierNightLiveRoundCount(value) {
  const n = Number(value);
  if (TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS.includes(n)) return true;
  if (TIER_NIGHT_LIVE_SERIES_LEGACY_ROUND_COUNTS.includes(n)) return true;
  return false;
}

/** @returns {string[]} */
export function listKnownTierNightLiveCategoryIds() {
  return (TIER_NIGHT_LIVE_CATEGORIES || []).map((c) => String(c.id));
}

/**
 * Options UI (ordre registry).
 * @returns {Array<{ id: string, label: string, order: number }>}
 */
export function listTierNightLiveCategoryOptions() {
  return (TIER_NIGHT_LIVE_CATEGORIES || [])
    .map((c) => ({
      id: String(c.id),
      label: String(c.label ?? c.id),
      order: Number(c.order) || 0,
    }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Forme seule (alignée conventions roster / SQL structurel).
 * @param {unknown} categoryIds
 */
export function validateTierNightLiveSeriesCategoryIdsShape(categoryIds) {
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
    if (s === TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES) hasStar = true;
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

/**
 * Forme + appartenance registry JS Rank Live.
 * @param {unknown} categoryIds
 */
export function validateTierNightLiveSeriesCategoryIds(categoryIds) {
  const shape = validateTierNightLiveSeriesCategoryIdsShape(categoryIds);
  if (!shape.ok) return shape;
  if (
    shape.categoryIds.length === 1 &&
    shape.categoryIds[0] === TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES
  ) {
    return shape;
  }
  const known = new Set(listKnownTierNightLiveCategoryIds());
  for (const id of shape.categoryIds) {
    if (!known.has(id)) {
      return { ok: false, code: "UNKNOWN_CATEGORY_ID", message: id };
    }
  }
  return shape;
}

/** @deprecated alias — utiliser validateTierNightLiveSeriesCategoryIds */
export function validateTierNightLiveSeriesCategoryIdsV1(categoryIds) {
  return validateTierNightLiveSeriesCategoryIds(categoryIds);
}

/**
 * @param {unknown} categoryIds
 * @returns {string[]}
 */
export function resolveTierNightLiveSetupCategoryIds(categoryIds) {
  if (
    categoryIds == null ||
    !Array.isArray(categoryIds) ||
    categoryIds.length === 0 ||
    categoryIds.some((id) => String(id) === TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES)
  ) {
    return [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES];
  }
  return categoryIds.map((c) => String(c));
}

/**
 * Normalise une valeur remote/legacy vers un tableau utilisable.
 * Invalide / vide → `["*"]` (compat).
 * @param {unknown} categoryIds
 * @returns {string[]}
 */
export function normalizeTierNightLivePrepCategoryIds(categoryIds) {
  const resolved = resolveTierNightLiveSetupCategoryIds(categoryIds);
  const validated = validateTierNightLiveSeriesCategoryIds(resolved);
  if (!validated.ok) return [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES];
  return validated.categoryIds;
}

function mapOfficialList(list) {
  return {
    id: String(list.id),
    name: String(list.name ?? ""),
    emoji: list.emoji != null ? String(list.emoji) : "📋",
    items: Array.isArray(list.items) ? list.items.map((item) => String(item)) : [],
    custom: false,
    categoryId: list.categoryId != null ? String(list.categoryId) : null,
  };
}

/**
 * Pool officiel filtré. Ne fusionne PAS `customTierLists` / `customLiveTierLists`.
 * @param {unknown} [categoryIds] - défaut `["*"]`
 */
export function getTierNightLiveOfficialPool(
  categoryIds = [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES]
) {
  const cats = resolveTierNightLiveSetupCategoryIds(categoryIds);
  const isAll = cats.includes(TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES);
  const allow = isAll ? null : new Set(cats);
  return (TIER_LISTS || [])
    .filter((list) => {
      if (isAll) return true;
      const cid = list?.categoryId != null ? String(list.categoryId) : "";
      return cid && allow.has(cid);
    })
    .map(mapOfficialList);
}

/**
 * @param {unknown} categoryIds
 * @param {{ customLists?: Iterable<object> }} [opts]
 */
export function getTierNightLivePoolSize(categoryIds, opts = {}) {
  const officials = getTierNightLiveOfficialPool(categoryIds);
  const customsResult = validateCustomLiveTierListsForBuild(opts.customLists || []);
  const customsLen = customsResult.ok ? customsResult.lists.length : 0;
  return officials.length + customsLen;
}

/**
 * @param {unknown} categoryIds
 * @param {{ customLists?: Iterable<object> }} [opts]
 */
export function getTierNightLiveRoundCountAvailability(categoryIds, opts = {}) {
  const poolSize = getTierNightLivePoolSize(categoryIds, opts);
  return TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS.map((roundCount) => ({
    roundCount,
    poolSize,
    available: poolSize >= roundCount,
  }));
}

/**
 * @param {unknown} categoryIds
 */
export function formatTierNightLiveCategorySummary(categoryIds) {
  const cats = resolveTierNightLiveSetupCategoryIds(categoryIds);
  if (cats.includes(TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES)) {
    return "Toutes les catégories";
  }
  const labels = cats
    .map((id) => TIER_NIGHT_LIVE_CATEGORIES.find((c) => c.id === id)?.label || id)
    .filter(Boolean);
  return labels.join(", ") || "Catégories";
}

/**
 * Construit le sous-ensemble de listes pour une série Rank Live.
 * Customs toujours éligibles quel que soit le filtre.
 */
export function buildTierNightLiveSeriesListSubset({
  officialLists,
  customLists = [],
  roundCount,
  categoryIds = [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES],
  random = Math.random,
} = {}) {
  if (!isValidTierNightLiveRoundCount(roundCount)) {
    return {
      ok: false,
      code: "INVALID_ROUND_COUNT",
      message: String(roundCount),
      requested: roundCount,
    };
  }
  const R = roundCount;

  const cats = validateTierNightLiveSeriesCategoryIds(categoryIds);
  if (!cats.ok) return cats;

  const customsResult = validateCustomLiveTierListsForBuild(customLists);
  if (!customsResult.ok) return customsResult;
  const customs = customsResult.lists;

  const officialsRaw = Array.isArray(officialLists)
    ? officialLists
    : getTierNightLiveOfficialPool(cats.categoryIds);

  const officialSeen = new Set();
  const officials = [];
  for (const raw of officialsRaw) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, code: "INVALID_OFFICIAL_POOL", message: "bad_entry" };
    }
    const id = raw.id != null ? String(raw.id).trim() : "";
    if (!id) {
      return { ok: false, code: "INVALID_OFFICIAL_POOL", message: "missing_id" };
    }
    if (officialSeen.has(id)) {
      return { ok: false, code: "DUPLICATE_OFFICIAL_ID", message: id };
    }
    officialSeen.add(id);
    const items = Array.isArray(raw.items)
      ? raw.items.map((item) => String(item))
      : [];
    officials.push({
      id,
      name: String(raw.name ?? ""),
      emoji: raw.emoji != null ? String(raw.emoji) : "📋",
      items,
      custom: false,
    });
  }

  for (const custom of customs) {
    if (officialSeen.has(custom.id)) {
      return { ok: false, code: "DUPLICATE_CUSTOM_ID", message: custom.id };
    }
  }

  const available = officials.length + customs.length;
  if (available < R) {
    return {
      ok: false,
      code: "INSUFFICIENT_POOL",
      requested: R,
      available,
      message: `need_${R}_have_${available}`,
    };
  }

  const picked = buildCombinedShuffledDeck(
    customs,
    officials,
    R,
    (requested) => Number(requested) || 0,
    typeof random === "function" ? random : Math.random
  );

  if (!Array.isArray(picked) || picked.length !== R) {
    return {
      ok: false,
      code: "INSUFFICIENT_POOL",
      requested: R,
      available: Array.isArray(picked) ? picked.length : 0,
      message: "builder_length_mismatch",
    };
  }

  const pickedIds = new Set();
  for (const entry of picked) {
    const id = entry?.id != null ? String(entry.id) : "";
    if (!id || pickedIds.has(id)) {
      return { ok: false, code: "DUPLICATE_SELECTION_ID", message: id || "empty" };
    }
    pickedIds.add(id);
  }

  const lists = picked.map((entry) => ({
    id: String(entry.id),
    name: String(entry.name ?? ""),
    emoji: entry.emoji != null ? String(entry.emoji) : "📋",
    items: Array.isArray(entry.items) ? entry.items.map((item) => String(item)) : [],
    custom: entry.custom === true,
    ...(entry.custom === true
      ? {
          author: entry.author != null ? String(entry.author) : "",
          authorUid: entry.authorUid != null ? String(entry.authorUid) : "",
        }
      : {}),
  }));

  return {
    ok: true,
    lists,
    roundCount: R,
    categoryIds: [...cats.categoryIds],
  };
}
