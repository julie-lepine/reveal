/**
 * FEATURE-TIERNIGHT-SERIES-04 / FEATURE-TIERNIGHT-03-A — état UI temporaire du setup série (pur).
 * Ne crée ni runId ni queue ; non sérialisé dans game_sessions.
 */

import { TIER_NIGHT_ROSTER_CATEGORIES } from "../../data/tierTopics.js";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  TIER_NIGHT_SERIES_ROUND_COUNTS,
  countEligibleTierNightSeriesTopics,
  countTierNightSeriesTopicPool,
  listEligibleTierNightSeriesTopics,
  buildTierNightSeriesTopicPool,
} from "./tierNightSeries.js";

export const TIER_NIGHT_SERIES_SETUP_PATHS = Object.freeze(["single", "series"]);

/**
 * @returns {{ path: null|string, categoryIds: null|string[], roundCount: null|number }}
 */
export function createEmptyTierNightSeriesSetup() {
  return {
    path: null,
    categoryIds: null,
    roundCount: null,
  };
}

/**
 * Options catégories pour l’UI (counts catalogue seuls — les customs sont globaux au pool).
 * @returns {Array<{ id: string, label: string, order: number, eligibleCount: number }>}
 */
export function listTierNightSeriesCategoryOptions() {
  return TIER_NIGHT_ROSTER_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    order: c.order,
    eligibleCount: countEligibleTierNightSeriesTopics({ categoryIds: [c.id] }),
  })).sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * @param {string[]|null} categoryIds
 */
export function resolveTierNightSeriesSetupCategoryIds(categoryIds) {
  if (
    categoryIds == null ||
    !Array.isArray(categoryIds) ||
    categoryIds.length === 0 ||
    categoryIds.some((id) => String(id) === TIER_NIGHT_SERIES_ALL_CATEGORIES)
  ) {
    return [TIER_NIGHT_SERIES_ALL_CATEGORIES];
  }
  return categoryIds.map((c) => String(c));
}

/**
 * Taille du pool série (officiels filtrés + customs non consommés).
 * @param {string[]|null} categoryIds
 * @param {{ customTopics?: Iterable<object>, excludeCustomIds?: Iterable<string>|null }} [opts]
 */
export function getTierNightSeriesPoolSize(categoryIds, opts = {}) {
  return countTierNightSeriesTopicPool({
    categoryIds: resolveTierNightSeriesSetupCategoryIds(categoryIds),
    customTopics: opts.customTopics || [],
    excludeCustomIds: opts.excludeCustomIds ?? null,
  });
}

/**
 * Disponibilité 3/5/8 pour le pool courant (pas de clamp silencieux).
 * @param {string[]|null} categoryIds
 * @param {{ customTopics?: Iterable<object>, excludeCustomIds?: Iterable<string>|null }} [opts]
 */
export function getTierNightSeriesRoundCountAvailability(categoryIds, opts = {}) {
  const poolSize = getTierNightSeriesPoolSize(categoryIds, opts);
  return TIER_NIGHT_SERIES_ROUND_COUNTS.map((roundCount) => ({
    roundCount,
    poolSize,
    available: poolSize >= roundCount,
  }));
}

/**
 * @param {object} setup
 * @param {{ customTopics?: Iterable<object>, excludeCustomIds?: Iterable<string>|null }} [opts]
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function validateTierNightSeriesSetupForLaunch(setup, opts = {}) {
  if (!setup || setup.path !== "series") {
    return { ok: false, code: "NOT_SERIES_PATH", message: "Parcours série requis." };
  }
  if (setup.categoryIds == null) {
    return { ok: false, code: "NO_CATEGORY", message: "Choisis une catégorie." };
  }
  const roundCount = Number(setup.roundCount);
  if (!TIER_NIGHT_SERIES_ROUND_COUNTS.includes(roundCount)) {
    return {
      ok: false,
      code: "NO_ROUND_COUNT",
      message: "Choisis 3, 5 ou 8 manches.",
    };
  }
  const cats = resolveTierNightSeriesSetupCategoryIds(setup.categoryIds);
  const poolSize = getTierNightSeriesPoolSize(cats, opts);
  if (poolSize < roundCount) {
    return {
      ok: false,
      code: "INSUFFICIENT_TOPICS",
      message: `Seulement ${poolSize} thème${poolSize > 1 ? "s" : ""} disponible${poolSize > 1 ? "s" : ""} pour ${roundCount} manches.`,
      poolSize,
      roundCount,
    };
  }
  return { ok: true };
}

/**
 * Invalide roundCount si le pool ne le permet plus.
 * @param {object} setup
 * @param {{ customTopics?: Iterable<object>, excludeCustomIds?: Iterable<string>|null }} [opts]
 */
export function reconcileTierNightSeriesSetupAfterCategoryChange(setup, opts = {}) {
  const next = {
    path: setup?.path ?? null,
    categoryIds: setup?.categoryIds ?? null,
    roundCount: setup?.roundCount ?? null,
  };
  if (next.roundCount == null || next.categoryIds == null) return next;
  const avail = getTierNightSeriesRoundCountAvailability(next.categoryIds, opts).find(
    (r) => r.roundCount === Number(next.roundCount)
  );
  if (!avail?.available) {
    next.roundCount = null;
  }
  return next;
}

/**
 * Libellé court pour le récap.
 * @param {string[]|null} categoryIds
 */
export function formatTierNightSeriesCategorySummary(categoryIds) {
  const cats = resolveTierNightSeriesSetupCategoryIds(categoryIds);
  if (cats.includes(TIER_NIGHT_SERIES_ALL_CATEGORIES)) {
    return "Toutes les catégories";
  }
  const labels = cats
    .map((id) => TIER_NIGHT_ROSTER_CATEGORIES.find((c) => c.id === id)?.label || id)
    .filter(Boolean);
  return labels.join(", ") || "Catégories";
}

/**
 * Aperçu catalogue (sans customs) — rétrocompat UI gate.
 * @param {string[]|null} categoryIds
 */
export function peekEligibleTopicsForSetup(categoryIds) {
  return listEligibleTierNightSeriesTopics({
    categoryIds: resolveTierNightSeriesSetupCategoryIds(categoryIds),
  });
}

/**
 * Aperçu pool série complet (officiels + customs non consommés).
 * @param {string[]|null} categoryIds
 * @param {{ customTopics?: Iterable<object>, excludeCustomIds?: Iterable<string>|null }} [opts]
 */
export function peekSeriesTopicPoolForSetup(categoryIds, opts = {}) {
  return buildTierNightSeriesTopicPool({
    categoryIds: resolveTierNightSeriesSetupCategoryIds(categoryIds),
    customTopics: opts.customTopics || [],
    excludeCustomIds: opts.excludeCustomIds ?? null,
  });
}
