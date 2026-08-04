/**
 * FEATURE-TIERNIGHT-SERIES-03A/B — validation canonique placement / finished.
 * Miroir SQL `tiernight_series_validate_*`. Pur : pas de DOM / Supabase / state.
 */

const ALLOWED_TIERS = Object.freeze(["S", "A", "B", "C", "D"]);

/**
 * @param {unknown} expectedItems
 * @returns {{ ok: true, items: string[] } | { ok: false, code: string }}
 */
export function validateTierNightSeriesExpectedItems(expectedItems) {
  if (!Array.isArray(expectedItems)) {
    return { ok: false, code: "TNS_ITEMS_NOT_ARRAY" };
  }
  if (expectedItems.length === 0) {
    return { ok: false, code: "TNS_ITEMS_EMPTY" };
  }
  const seen = new Set();
  const items = [];
  for (const raw of expectedItems) {
    if (typeof raw !== "string" || raw.length === 0) {
      return { ok: false, code: "TNS_ITEMS_INVALID_VALUE" };
    }
    if (seen.has(raw)) {
      return { ok: false, code: "TNS_ITEMS_DUPLICATE" };
    }
    seen.add(raw);
    items.push(raw);
  }
  return { ok: true, items };
}

/**
 * Miroir SQL `tiernight_series_validate_finished`.
 * Valeurs roster : uniquement boolean. Absent = non terminé.
 * Clés hors roster ignorées pour l’éligibilité.
 *
 * @param {unknown} finished
 * @param {Array<{userId?: string}>} roster
 */
export function validateTierNightSeriesFinished(finished, roster = []) {
  if (finished == null) return { ok: true };
  if (typeof finished !== "object" || Array.isArray(finished)) {
    return { ok: false, code: "TNS_FINISHED_INVALID" };
  }
  for (const entry of roster) {
    const uid = entry?.userId != null ? String(entry.userId) : "";
    if (!uid) continue;
    if (!Object.prototype.hasOwnProperty.call(finished, uid)) continue;
    if (typeof finished[uid] !== "boolean") {
      return { ok: false, code: "TNS_FINISHED_INVALID_VALUE", detail: uid };
    }
  }
  return { ok: true };
}

/** True uniquement si boolean JSON true (après validate_finished). */
export function isTierNightSeriesFinishedFlag(finished, uid) {
  const id = uid != null ? String(uid) : "";
  if (!id || finished == null || typeof finished !== "object") return false;
  return finished[id] === true;
}

/**
 * @param {unknown} placement
 * @param {unknown} expectedItems
 * @returns {{ ok: true } | { ok: false, code: string, detail?: string }}
 */
export function validateTierNightSeriesPlacement(placement, expectedItems) {
  const expected = validateTierNightSeriesExpectedItems(expectedItems);
  if (!expected.ok) return expected;

  if (placement == null || typeof placement !== "object" || Array.isArray(placement)) {
    return { ok: false, code: "TNS_PLACEMENT_NOT_OBJECT" };
  }

  const expectedSet = new Set(expected.items);
  const seen = new Map();

  for (const key of Object.keys(placement)) {
    if (!ALLOWED_TIERS.includes(key)) {
      return { ok: false, code: "TNS_PLACEMENT_UNKNOWN_TIER", detail: key };
    }
    const arr = placement[key];
    if (!Array.isArray(arr)) {
      return { ok: false, code: "TNS_PLACEMENT_TIER_NOT_ARRAY", detail: key };
    }
    for (const el of arr) {
      if (typeof el !== "string" || el.length === 0) {
        return { ok: false, code: "TNS_PLACEMENT_ITEM_NOT_TEXT", detail: key };
      }
      if (!expectedSet.has(el)) {
        return { ok: false, code: "TNS_PLACEMENT_UNKNOWN_ITEM", detail: el };
      }
      if (seen.has(el)) {
        return { ok: false, code: "TNS_PLACEMENT_DUPLICATE_ITEM", detail: el };
      }
      seen.set(el, key);
    }
  }

  for (const item of expected.items) {
    if (!seen.has(item)) {
      return { ok: false, code: "TNS_PLACEMENT_MISSING_ITEM", detail: item };
    }
  }

  if (seen.size !== expected.items.length) {
    return { ok: false, code: "TNS_PLACEMENT_COUNT_MISMATCH" };
  }

  return { ok: true };
}

/**
 * Participants force : roster ∩ finished ∧ placement valide.
 * @param {object} opts
 */
export function selectTierNightSeriesForceParticipants({
  roster = [],
  finished = {},
  placements = {},
  items = [],
} = {}) {
  const finCheck = validateTierNightSeriesFinished(finished, roster);
  if (!finCheck.ok) {
    return { participants: [], errors: [finCheck], foreignFinished: [] };
  }

  const participants = [];
  const errors = [];

  for (const entry of roster) {
    const uid = entry?.userId != null ? String(entry.userId) : "";
    if (!uid) continue;
    if (!isTierNightSeriesFinishedFlag(finished, uid)) continue;
    const placed = placements[uid];
    const v = validateTierNightSeriesPlacement(placed, items);
    if (!v.ok) {
      errors.push({ uid, code: v.code, detail: v.detail });
      continue;
    }
    participants.push(uid);
  }

  const foreignFinished = Object.keys(finished || {}).filter((uid) => {
    if (!isTierNightSeriesFinishedFlag(finished, uid)) return false;
    return !roster.some((r) => String(r?.userId || "") === uid);
  });

  return { participants, errors, foreignFinished };
}
