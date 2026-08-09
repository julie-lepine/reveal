/**
 * FEATURE-TIERNIGHT-04B — domaine pur Rank Live série (counts, pool officiel, builder).
 *
 * Sélectionne un SOUS-ENSEMBLE de listes pour une future queue (04E).
 * Ne crée pas runId / roundId / series wire / state / Supabase.
 *
 * Réutilise `buildCombinedShuffledDeck` TEL QUEL (décision A/B : wrapper live, pas de
 * modification de `combinedGameDeck.js`).
 */

import { TIER_LISTS } from "../../data/tierTopics.js";
import { buildCombinedShuffledDeck } from "./combinedGameDeck.js";
import { validateCustomLiveTierListsForBuild } from "./customLiveTierLists.js";

/** Counts autorisés pour une NOUVELLE série Rank Live (distinct du roster 3/5/8). */
export const TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS = Object.freeze([3, 5, 7]);

export const DEFAULT_TIER_NIGHT_LIVE_SERIES_ROUND_COUNT = 5;

/** Sentinelle forward-compat — V1 : seule valeur valide. */
export const TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES = "*";

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidTierNightLiveRoundCount(value) {
  return TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS.includes(value);
}

/**
 * Pool officiel V1 = tout `TIER_LISTS`.
 * Ne fusionne PAS `customTierLists` local.
 * Copie défensive (listes + items) — ne mute jamais le catalogue source.
 *
 * @returns {Array<{ id: string, name: string, emoji?: string, items: string[], custom: false }>}
 */
export function getTierNightLiveOfficialPool() {
  return (TIER_LISTS || []).map((list) => ({
    id: String(list.id),
    name: String(list.name ?? ""),
    emoji: list.emoji != null ? String(list.emoji) : "📋",
    items: Array.isArray(list.items) ? list.items.map((item) => String(item)) : [],
    custom: false,
  }));
}

/**
 * V1 : uniquement `["*"]` (catalogue global). Toute autre valeur = erreur.
 * @param {unknown} categoryIds
 */
export function validateTierNightLiveSeriesCategoryIdsV1(categoryIds) {
  if (!Array.isArray(categoryIds)) {
    return { ok: false, code: "INVALID_CATEGORY_IDS", message: "not_array" };
  }
  if (
    categoryIds.length !== 1 ||
    categoryIds[0] !== TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES
  ) {
    return { ok: false, code: "INVALID_CATEGORY_IDS", message: "v1_star_only" };
  }
  return { ok: true, categoryIds: [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES] };
}

/**
 * Construit le sous-ensemble de listes pour une série Rank Live.
 *
 * @param {object} [opts]
 * @param {unknown[]} [opts.officialLists] — défaut : pool officiel global
 * @param {unknown[]} [opts.customLists] — `customLiveTierLists` (pas la lib locale)
 * @param {unknown} opts.roundCount
 * @param {unknown} [opts.categoryIds] — V1 défaut `["*"]`
 * @param {() => number} [opts.random]
 * @returns {{
 *   ok: true,
 *   lists: object[],
 *   roundCount: number,
 *   categoryIds: string[]
 * } | {
 *   ok: false,
 *   code: string,
 *   message?: string,
 *   requested?: number,
 *   available?: number
 * }}
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

  const cats = validateTierNightLiveSeriesCategoryIdsV1(categoryIds);
  if (!cats.ok) return cats;

  const customsResult = validateCustomLiveTierListsForBuild(customLists);
  if (!customsResult.ok) return customsResult;
  const customs = customsResult.lists;

  const officialsRaw = Array.isArray(officialLists)
    ? officialLists
    : getTierNightLiveOfficialPool();

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

  // Namespace : un custom ne doit pas collisonner un id officiel (préfixe custom-live-).
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

  // Même politique REVEAL que roster/Dilemma : customs prioritaires, pas de giant-shuffle+slice.
  // resolveEffectiveRoundCount : ne pas clamper — R strict ; assert longueur ensuite.
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

  // Copie défensive du résultat (items inclus).
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
