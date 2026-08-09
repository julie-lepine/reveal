/**
 * Modération texte Hot Take / customs (pur, sync, local).
 * Extraite de hotTakeSession pour éviter d'importer le client sync / Supabase.
 */
import {
  HOT_TAKE_FORBIDDEN_WORDS,
  HOT_TAKE_MODERATION_NOTICE,
} from "../../data/hotTakes.js";

function normalizeForModeration(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * @param {string} text
 * @returns {{ blocked: false }|{ blocked: true, message: string }}
 */
export function checkHotTakeModeration(text) {
  const normalized = normalizeForModeration(text);
  const hit = HOT_TAKE_FORBIDDEN_WORDS.find((word) => {
    const w = normalizeForModeration(word);
    return w && normalized.includes(w);
  });
  if (hit) {
    return {
      blocked: true,
      message: `${HOT_TAKE_MODERATION_NOTICE} (terme interdit détecté.)`,
    };
  }
  return { blocked: false };
}

export function getHotTakeModerationNotice() {
  return HOT_TAKE_MODERATION_NOTICE;
}
