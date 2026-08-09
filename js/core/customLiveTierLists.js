/**
 * FEATURE-TIERNIGHT-04B — domaine pur : customs Rank Live (`customLiveTierLists`).
 *
 * Structure / normalisation uniquement. Pas de state, Supabase, ni modération.
 * Modération (`checkHotTakeModeration`) : brancher en 04C/04D à la contribution UI/session.
 */

export const CUSTOM_LIVE_TIER_LIST_ID_PREFIX = "custom-live-";

export const LIVE_TIER_LIST_NAME_MIN = 2;
export const LIVE_TIER_LIST_NAME_MAX = 40;
export const LIVE_TIER_LIST_EMOJI_DEFAULT = "✨";
export const LIVE_TIER_LIST_EMOJI_MAX = 4;
export const LIVE_TIER_LIST_ITEMS_MIN = 4;
export const LIVE_TIER_LIST_ITEMS_MAX = 16;
export const LIVE_TIER_LIST_ITEM_MAX = 40;
/** Borne serveur prévue 04C — mesurée en code units UTF-16 de `JSON.stringify(entry)`. */
export const LIVE_TIER_LIST_ENTRY_JSON_MAX_BYTES = 4096;

/**
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeLiveTierListName(text) {
  return String(text ?? "").trim().slice(0, LIVE_TIER_LIST_NAME_MAX);
}

/**
 * @param {unknown} emoji
 * @returns {string}
 */
export function normalizeLiveTierListEmoji(emoji) {
  const raw = String(emoji ?? "").trim();
  if (!raw) return LIVE_TIER_LIST_EMOJI_DEFAULT;
  return raw.slice(0, LIVE_TIER_LIST_EMOJI_MAX) || LIVE_TIER_LIST_EMOJI_DEFAULT;
}

/**
 * Trim défensif des items ; ne droppe pas les vides (validation séparée).
 * @param {unknown} items
 * @returns {string[]|null}
 */
export function normalizeLiveTierListItems(items) {
  if (!Array.isArray(items)) return null;
  return items.map((item) => String(item ?? "").trim());
}

/**
 * Clé d’unicité item : trim + lower case (code units, comme le reste de REVEAL).
 * @param {string} item
 */
export function liveTierListItemDedupeKey(item) {
  return String(item ?? "").trim().toLowerCase();
}

export function createCustomLiveTierListId() {
  if (globalThis.crypto?.randomUUID) {
    return `${CUSTOM_LIVE_TIER_LIST_ID_PREFIX}${globalThis.crypto.randomUUID()}`;
  }
  return `${CUSTOM_LIVE_TIER_LIST_ID_PREFIX}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isCustomLiveTierListId(id) {
  const s = id != null ? String(id).trim() : "";
  return Boolean(s) && s.startsWith(CUSTOM_LIVE_TIER_LIST_ID_PREFIX);
}

/**
 * Normalisation d’entrée (trim / emoji défaut / copie items).
 * Ne valide pas ; ne corrige pas les longueurs hors slice name/emoji.
 *
 * @param {unknown} input
 * @returns {{
 *   id: string,
 *   name: string,
 *   emoji: string,
 *   items: string[],
 *   author: string,
 *   authorUid: string,
 *   custom: true
 * }|null}
 */
export function normalizeCustomLiveTierListInput(input) {
  if (!input || typeof input !== "object") return null;
  const items = normalizeLiveTierListItems(input.items);
  if (!items) return null;
  return {
    id: input.id != null ? String(input.id).trim() : "",
    name: normalizeLiveTierListName(input.name),
    emoji: normalizeLiveTierListEmoji(input.emoji),
    items: [...items],
    author: input.author != null ? String(input.author).trim() : "",
    authorUid: input.authorUid != null ? String(input.authorUid).trim() : "",
    custom: true,
  };
}

/**
 * Validation structurelle stricte (domaine).
 * Longueurs mesurées en code units UTF-16 (`String.length`) — convention REVEAL.
 *
 * @param {unknown} input
 * @returns {{
 *   ok: true,
 *   list: {
 *     id: string,
 *     name: string,
 *     emoji: string,
 *     items: string[],
 *     author: string,
 *     authorUid: string,
 *     custom: true
 *   }
 * } | {
 *   ok: false,
 *   code: string,
 *   message?: string
 * }}
 */
export function validateCustomLiveTierList(input) {
  const normalized = normalizeCustomLiveTierListInput(input);
  if (!normalized) {
    return { ok: false, code: "INVALID_CUSTOM_LIVE_LIST", message: "not_object_or_items" };
  }

  // custom doit être présent et strictement boolean true (pas de réparation silencieuse).
  if (!input || typeof input !== "object" || !Object.prototype.hasOwnProperty.call(input, "custom")) {
    return { ok: false, code: "INVALID_CUSTOM_FLAG", message: "custom_required" };
  }
  if (input.custom !== true) {
    return { ok: false, code: "INVALID_CUSTOM_FLAG", message: "custom_must_be_true" };
  }

  if (!isCustomLiveTierListId(normalized.id)) {
    return { ok: false, code: "INVALID_CUSTOM_LIVE_ID", message: normalized.id || "missing_id" };
  }

  const rawNameLen = String(input?.name ?? "").trim().length;
  if (rawNameLen > LIVE_TIER_LIST_NAME_MAX) {
    return {
      ok: false,
      code: "INVALID_NAME_LENGTH",
      message: `max_${LIVE_TIER_LIST_NAME_MAX}`,
    };
  }
  if (normalized.name.length < LIVE_TIER_LIST_NAME_MIN) {
    return {
      ok: false,
      code: "INVALID_NAME_LENGTH",
      message: `min_${LIVE_TIER_LIST_NAME_MIN}`,
    };
  }

  const rawEmoji = String(input?.emoji ?? "").trim();
  if (rawEmoji && rawEmoji.length > LIVE_TIER_LIST_EMOJI_MAX) {
    return {
      ok: false,
      code: "INVALID_EMOJI_LENGTH",
      message: `max_${LIVE_TIER_LIST_EMOJI_MAX}`,
    };
  }

  if (normalized.items.length < LIVE_TIER_LIST_ITEMS_MIN) {
    return {
      ok: false,
      code: "INVALID_ITEMS_COUNT",
      message: `min_${LIVE_TIER_LIST_ITEMS_MIN}`,
    };
  }
  if (normalized.items.length > LIVE_TIER_LIST_ITEMS_MAX) {
    return {
      ok: false,
      code: "INVALID_ITEMS_COUNT",
      message: `max_${LIVE_TIER_LIST_ITEMS_MAX}`,
    };
  }

  const seenKeys = new Set();
  for (const item of normalized.items) {
    if (!item) {
      return { ok: false, code: "INVALID_ITEM_BLANK" };
    }
    if (item.length > LIVE_TIER_LIST_ITEM_MAX) {
      return {
        ok: false,
        code: "INVALID_ITEM_LENGTH",
        message: `max_${LIVE_TIER_LIST_ITEM_MAX}`,
      };
    }
    const key = liveTierListItemDedupeKey(item);
    if (seenKeys.has(key)) {
      return { ok: false, code: "DUPLICATE_ITEM", message: item };
    }
    seenKeys.add(key);
  }

  if (!normalized.author) {
    return { ok: false, code: "INVALID_AUTHOR" };
  }
  if (!normalized.authorUid) {
    return { ok: false, code: "INVALID_AUTHOR_UID" };
  }

  const list = {
    id: normalized.id,
    name: normalized.name,
    emoji: normalized.emoji,
    items: [...normalized.items],
    author: normalized.author,
    authorUid: normalized.authorUid,
    custom: true,
  };

  let jsonLen;
  try {
    jsonLen = JSON.stringify(list).length;
  } catch {
    return { ok: false, code: "INVALID_CUSTOM_LIVE_LIST", message: "json_serialize" };
  }
  if (jsonLen > LIVE_TIER_LIST_ENTRY_JSON_MAX_BYTES) {
    return {
      ok: false,
      code: "ENTRY_TOO_LARGE",
      message: `max_${LIVE_TIER_LIST_ENTRY_JSON_MAX_BYTES}`,
    };
  }

  return { ok: true, list };
}

/**
 * Sanitize lecture (storage / collection) : invalides ignorés, ids dédupliqués.
 * @param {unknown} raw
 * @returns {ReturnType<typeof validateCustomLiveTierList> extends {ok:true, list:infer L} ? L[] : never}
 */
export function sanitizeCustomLiveTierListsCollection(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const result = validateCustomLiveTierList(entry);
    if (!result.ok) continue;
    if (seen.has(result.list.id)) continue;
    seen.add(result.list.id);
    out.push(result.list);
  }
  return out;
}

/**
 * Pour le builder : tous les entrées doivent être valides ; ids uniques.
 * @param {unknown} raw
 */
export function validateCustomLiveTierListsForBuild(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, code: "INVALID_CUSTOM_POOL", message: "not_array" };
  }
  const seen = new Set();
  const lists = [];
  for (const entry of raw) {
    const result = validateCustomLiveTierList(entry);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code || "INVALID_CUSTOM_LIVE_LIST",
        message: result.message,
      };
    }
    if (seen.has(result.list.id)) {
      return { ok: false, code: "DUPLICATE_CUSTOM_ID", message: result.list.id };
    }
    seen.add(result.list.id);
    lists.push(result.list);
  }
  return { ok: true, lists };
}
