/**
 * Mots personnalisés Draw it ! — pool prépa, deck au launch, mutations RPC.
 * Modération : checkHotTakeModeration (même pipeline REVEAL).
 * Deck : buildCombinedShuffledDeck (customs prioritaires, pas de mélange global).
 */
import {
  isPlayerTextTooLong,
  playerTextMaxError,
  trimPlayerText,
} from "../../data/playerTextLimits.js";
import {
  DRAW_IT_CATALOG_ID,
  DRAW_IT_WORDS,
  getDrawItCategoryWords,
  isDrawItCategoryId,
  isDrawItRoundCount,
} from "../../data/drawIt.js";
import { checkHotTakeModeration } from "./hotTakeModeration.js";
import { buildCombinedShuffledDeck, dedupeEntriesById } from "./combinedGameDeck.js";
import { normalizeDrawItGuess } from "./drawItNormalize.js";
import {
  isDrawItCustomWordOwnedBy,
  mergeDrawItCustomWords,
  normalizeDrawItCustomWord,
  sanitizeDrawItCustomWords,
} from "./sessionMerge.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";

export {
  isDrawItCustomWordOwnedBy,
  mergeDrawItCustomWords,
  normalizeDrawItCustomWord,
  sanitizeDrawItCustomWords,
};

export const DRAW_IT_CUSTOM_LOCKED = "DRAWIT_CUSTOM_LOCKED";

export function canMutateDrawItCustomWords(session = {}) {
  return !session?.lobbyStarted && !session?.runId;
}

export function clearDrawItCustomWords(session = {}) {
  return { ...session, customWords: [] };
}

function distinctCatalogPool(categoryId, words = DRAW_IT_WORDS) {
  return dedupeEntriesById(getDrawItCategoryWords(categoryId, words));
}

function uniqueCustomWordEntries(customWords = []) {
  const seen = new Set();
  const out = [];
  for (const item of sanitizeDrawItCustomWords(customWords)) {
    const key = normalizeDrawItGuess(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: item.id,
      label: item.text,
      categoryId: "custom",
      enabled: true,
      acceptedAnswers: [item.text],
      author: item.author || null,
      custom: true,
    });
  }
  return out;
}

function catalogWithoutCustomLabels(catalog, customEntries) {
  const keys = new Set(
    customEntries.map((entry) => normalizeDrawItGuess(entry.label)).filter(Boolean)
  );
  return catalog.filter((word) => {
    const key = normalizeDrawItGuess(word?.label);
    return key && !keys.has(key);
  });
}

export function resolveDrawItDeckRoundCount(requested, poolSize) {
  const n = Number(requested);
  if (!isDrawItRoundCount(n)) return 0;
  if (!Number.isFinite(Number(poolSize)) || Number(poolSize) < n) return 0;
  return n;
}

/**
 * Construit le deck Draw it : customs d'abord, catalogue uniquement pour compléter.
 * Ne mélange jamais customs+catalogue avant la sélection.
 */
export function buildDrawItDeck({
  categoryId,
  roundCount,
  customWords = [],
  catalogWords = DRAW_IT_WORDS,
  random = Math.random,
} = {}) {
  if (!isDrawItCategoryId(categoryId) || !isDrawItRoundCount(roundCount)) return [];
  const customs = uniqueCustomWordEntries(customWords);
  const catalog = distinctCatalogPool(categoryId, catalogWords);
  const bank = catalogWithoutCustomLabels(catalog, customs);
  return buildCombinedShuffledDeck(
    customs,
    bank,
    roundCount,
    resolveDrawItDeckRoundCount,
    random
  );
}

export function drawItAvailablePoolSize({
  categoryId,
  customWords = [],
  catalogWords = DRAW_IT_WORDS,
} = {}) {
  if (!isDrawItCategoryId(categoryId)) return 0;
  const customs = uniqueCustomWordEntries(customWords);
  const catalog = distinctCatalogPool(categoryId, catalogWords);
  return customs.length + catalogWithoutCustomLabels(catalog, customs).length;
}

function persistCustomWords(session, customWords) {
  saveStatePatch({
    drawItGame: { ...session, customWords: sanitizeDrawItCustomWords(customWords) },
  });
}

function createCustomWordId() {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDrawItCustomWords(session) {
  return sanitizeDrawItCustomWords(session?.customWords);
}

export function getMyDrawItCustomWords(session, localAuthor, localAuthorUid) {
  const me = localAuthor ?? getLocalDisplayName();
  return getDrawItCustomWords(session).filter((item) =>
    isDrawItCustomWordOwnedBy(item, me, localAuthorUid)
  );
}

/**
 * @returns {Promise<{ ok: true, id: string, entry: object }|{ ok: false, error: string }>}
 */
export async function addDrawItCustomWord(text, session) {
  if (!canMutateDrawItCustomWords(session)) {
    return { ok: false, error: "La partie a déjà commencé." };
  }
  if (isPlayerTextTooLong(text)) return { ok: false, error: playerTextMaxError() };
  const trimmed = trimPlayerText(text);
  if (!trimmed) return { ok: false, error: "Texte vide." };

  const mod = checkHotTakeModeration(trimmed);
  if (mod.blocked) return { ok: false, error: mod.message };

  const { isGameSyncActive, getLocalParticipantUid } = await import("./gameSync.js");
  const authorUid = getLocalParticipantUid() || null;
  const entry = {
    id: createCustomWordId(),
    text: trimmed,
    author: getLocalDisplayName(),
    ...(authorUid ? { authorUid } : {}),
  };
  const merged = mergeDrawItCustomWords(
    [...getDrawItCustomWords(session), entry],
    [],
    getLocalDisplayName(),
    authorUid
  );
  persistCustomWords(session, merged);

  if (!isGameSyncActive()) return { ok: true, id: entry.id, entry };

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true, id: entry.id, entry };

  try {
    const { rpcUpsertPlayerCustomEntry } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
    const row = await rpcUpsertPlayerCustomEntry({
      lobbyId,
      game: "drawit",
      entry,
    });
    const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
    if (full) applyRemoteSession(full);
    return { ok: true, id: entry.id, entry };
  } catch (e) {
    const code = String(e?.message || "");
    const cur = getState().drawItGame || session;
    persistCustomWords(
      cur,
      getDrawItCustomWords(cur).filter((item) => item.id !== entry.id)
    );
    if (code.includes(DRAW_IT_CUSTOM_LOCKED) || code.includes("DRAWIT_WRONG_GAME")) {
      return { ok: false, error: "La partie a déjà commencé." };
    }
    return { ok: false, error: e?.message || "Impossible d'ajouter le mot." };
  }
}

/**
 * @returns {Promise<{ ok: true }|{ ok: false, error: string }>}
 */
export async function removeDrawItCustomWord(wordId, session, { localAuthor, localAuthorUid } = {}) {
  if (!canMutateDrawItCustomWords(session)) {
    return { ok: false, error: "La partie a déjà commencé." };
  }
  const me = localAuthor ?? getLocalDisplayName();
  const uid = localAuthorUid ?? null;
  const id = String(wordId || "").trim();
  if (!id) return { ok: false, error: "Mot introuvable." };

  const current = getDrawItCustomWords(session);
  const target = current.find((item) => item.id === id);
  if (!target) return { ok: true };
  if (!isDrawItCustomWordOwnedBy(target, me, uid)) {
    return { ok: false, error: "Tu ne peux supprimer que tes propres mots." };
  }

  const next = current.filter((item) => item.id !== id);
  persistCustomWords(session, next);

  const { isGameSyncActive } = await import("./gameSync.js");
  if (!isGameSyncActive()) return { ok: true };

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true };

  try {
    const { rpcDeletePlayerCustomEntry } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
    const row = await rpcDeletePlayerCustomEntry({
      lobbyId,
      game: "drawit",
      entryId: id,
    });
    const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
    if (full) applyRemoteSession(full);
    return { ok: true };
  } catch (e) {
    const code = String(e?.message || "");
    const cur = getState().drawItGame || session;
    persistCustomWords(cur, [...getDrawItCustomWords(cur), target]);
    if (code.includes(DRAW_IT_CUSTOM_LOCKED) || code.includes("DRAWIT_WRONG_GAME")) {
      return { ok: false, error: "La partie a déjà commencé." };
    }
    return { ok: false, error: e?.message || "Impossible de supprimer le mot." };
  }
}

export function drawItCatalogPoolSize(categoryId = DRAW_IT_CATALOG_ID, words = DRAW_IT_WORDS) {
  return distinctCatalogPool(categoryId, words).length;
}
