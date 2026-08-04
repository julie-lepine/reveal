/**
 * FEATURE-TIERNIGHT-01 — thèmes roster personnalisés (« Classe le groupe »).
 */

export const ROSTER_TOPIC_NAME_MIN = 2;
export const ROSTER_TOPIC_NAME_MAX = 80;
export const CUSTOM_ROSTER_TOPIC_ID_PREFIX = "custom-roster-";

export function normalizeRosterTopicName(text) {
  return String(text ?? "").trim().slice(0, ROSTER_TOPIC_NAME_MAX);
}

export function validateRosterTopicName(text) {
  const name = normalizeRosterTopicName(text);
  if (!name) return { ok: false, error: "Donne un nom à ton thème." };
  const rawLen = String(text ?? "").trim().length;
  if (rawLen > ROSTER_TOPIC_NAME_MAX) {
    return { ok: false, error: `Maximum ${ROSTER_TOPIC_NAME_MAX} caractères.` };
  }
  if (name.length < ROSTER_TOPIC_NAME_MIN) {
    return { ok: false, error: `Minimum ${ROSTER_TOPIC_NAME_MIN} caractères.` };
  }
  return { ok: true, name };
}

export function createCustomRosterTopicId() {
  if (globalThis.crypto?.randomUUID) {
    return `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}${globalThis.crypto.randomUUID()}`;
  }
  return `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {unknown} entry
 * @returns {{ id: string, name: string, custom: true, author?: string }|null}
 */
export function sanitizeCustomRosterTopicEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.id != null ? String(entry.id).trim() : "";
  if (!id.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX)) return null;
  const name = normalizeRosterTopicName(entry.name);
  if (name.length < ROSTER_TOPIC_NAME_MIN) return null;
  // Compat : emoji historique ignoré (non relu, non persisté).
  const author =
    entry.author != null && String(entry.author).trim()
      ? String(entry.author).trim()
      : null;
  const out = {
    id,
    name,
    custom: true,
  };
  if (author) out.author = author;
  return out;
}

/** Normalisation pour merge MP (auteur requis côté sync). */
export function normalizeCustomRosterTopicEntry(entry) {
  const item = sanitizeCustomRosterTopicEntry(entry);
  if (!item) return null;
  return {
    ...item,
    author: item.author || null,
  };
}

/** @param {unknown} raw */
export function sanitizeCustomRosterTopicsFromStorage(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const item = sanitizeCustomRosterTopicEntry(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
