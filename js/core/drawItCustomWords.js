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
  redactDrawItCustomWordsForViewer,
  sanitizeDrawItCustomWords,
  stripDrawItCustomWordTexts,
} from "./sessionMerge.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import { getSupabaseUserId } from "./supabaseAuth.js";

export {
  isDrawItCustomWordOwnedBy,
  mergeDrawItCustomWords,
  normalizeDrawItCustomWord,
  redactDrawItCustomWordsForViewer,
  sanitizeDrawItCustomWords,
  stripDrawItCustomWordTexts,
};

export const DRAW_IT_CUSTOM_LOCKED = "DRAWIT_CUSTOM_LOCKED";

export function canMutateDrawItCustomWords(session = {}) {
  // Verrou = partie effectivement lancée. Un runId stale (localStorage /
  // merge guest) ne doit pas bloquer la prépa.
  return !session?.lobbyStarted;
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
    if (!item.text) continue;
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

export function countUniqueDrawItCustomWords(customWords = []) {
  return uniqueCustomWordEntries(customWords).length;
}

export function drawItAvailablePoolSize({
  categoryId,
  customWords = [],
  catalogWords = DRAW_IT_WORDS,
} = {}) {
  if (!isDrawItCategoryId(categoryId)) return 0;
  const all = sanitizeDrawItCustomWords(customWords);
  const customs = uniqueCustomWordEntries(all);
  const textless = all.filter((item) => !item.text).length;
  const catalog = distinctCatalogPool(categoryId, catalogWords);
  return customs.length + textless + catalogWithoutCustomLabels(catalog, customs).length;
}

export function summarizeOthersDrawItCustomAdds(
  entries = [],
  localAuthor,
  localAuthorUid = null
) {
  const byAuthor = new Map();
  for (const item of sanitizeDrawItCustomWords(entries)) {
    if (isDrawItCustomWordOwnedBy(item, localAuthor, localAuthorUid)) continue;
    const name = item.author || "Un joueur";
    byAuthor.set(name, (byAuthor.get(name) || 0) + 1);
  }
  return [...byAuthor.entries()].map(([author, count]) => ({ author, count }));
}

function persistCustomWords(session, customWords) {
  const latest = getState().drawItGame || session;
  saveStatePatch({
    drawItGame: { ...latest, customWords: sanitizeDrawItCustomWords(customWords) },
  });
}

const LAUNCH_CUSTOMS_ERROR =
  "Impossible de récupérer tous les mots personnalisés. Réessaie de lancer la partie.";

/**
 * Host launch : textes complets via RPC privée. Échec / incomplet → pas de fallback textless.
 * @returns {Promise<{ ok: true, customWords: object[] }|{ ok: false, error: string, customWords: object[] }>}
 */
export async function loadDrawItCustomWordsForLaunch(session) {
  const local = getDrawItCustomWords(session);
  const { isGameSyncActive } = await import("./gameSync.js");
  const { isSupabaseConfigured } = await import("./supabaseClient.js");
  if (!isGameSyncActive() || !isSupabaseConfigured()) {
    const incomplete = local.filter((item) => !item.text);
    if (incomplete.length) {
      return { ok: false, error: LAUNCH_CUSTOMS_ERROR, customWords: local };
    }
    return { ok: true, customWords: local };
  }

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) {
    return { ok: false, error: LAUNCH_CUSTOMS_ERROR, customWords: [] };
  }

  try {
    const { rpcFetchDrawItCustomWordsForLaunch } = await import("./gameSessionRpc.js");
    const rows = await rpcFetchDrawItCustomWordsForLaunch({ lobbyId });
    const fetched = sanitizeDrawItCustomWords(rows);
    const byId = new Map(fetched.map((item) => [item.id, item]));
    const missing = local.filter((item) => !byId.get(item.id)?.text);
    const incompleteFetched = fetched.filter((item) => !item.text);
    if (missing.length || incompleteFetched.length) {
      return { ok: false, error: LAUNCH_CUSTOMS_ERROR, customWords: [] };
    }
    const publicIds = new Set(local.map((item) => item.id));
    const extras = fetched.filter((item) => item.text && !publicIds.has(item.id));
    const merged = [
      ...local.map((item) => ({
        ...item,
        text: byId.get(item.id).text,
        author: byId.get(item.id).author || item.author,
        authorUid: byId.get(item.id).authorUid || item.authorUid,
      })),
      ...extras,
    ];
    return { ok: true, customWords: sanitizeDrawItCustomWords(merged) };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || LAUNCH_CUSTOMS_ERROR,
      customWords: [],
    };
  }
}

/**
 * Reconnexion owner : rattacher les textes privés aux métadonnées publiques.
 * Ne lit jamais les textes d'autrui.
 * @returns {Promise<boolean>} true si le state local a changé
 */
export async function hydrateOwnDrawItCustomWordsIfNeeded() {
  const { isGameSyncActive, getLocalParticipantUid } = await import("./gameSync.js");
  if (!isGameSyncActive()) return false;
  const { isSupabaseConfigured } = await import("./supabaseClient.js");
  if (!isSupabaseConfigured()) return false;
  const session = getState().drawItGame;
  if (!session || session.lobbyStarted) return false;
  const uid = getLocalParticipantUid() || getSupabaseUserId() || null;
  const me = getLocalDisplayName();
  const current = getDrawItCustomWords(session);
  const needFetch = current.some(
    (item) => isDrawItCustomWordOwnedBy(item, me, uid) && !item.text
  );
  if (!needFetch) return false;
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return false;
  try {
    const { rpcFetchMyDrawItCustomWords } = await import("./gameSessionRpc.js");
    const rows = await rpcFetchMyDrawItCustomWords({ lobbyId });
    const mine = sanitizeDrawItCustomWords(rows);
    if (!mine.length) return false;
    const byId = new Map(mine.map((item) => [item.id, item]));
    let changed = false;
    const next = current.map((item) => {
      if (!isDrawItCustomWordOwnedBy(item, me, uid)) return item;
      const priv = byId.get(item.id);
      if (!priv?.text || priv.text === item.text) return item;
      changed = true;
      return {
        ...item,
        text: priv.text,
        author: priv.author || item.author,
        authorUid: priv.authorUid || item.authorUid,
      };
    });
    if (!changed) return false;
    persistCustomWords(getState().drawItGame || session, next);
    return true;
  } catch {
    return false;
  }
}

function createCustomWordId() {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDrawItCustomWords(session) {
  return sanitizeDrawItCustomWords(session?.customWords);
}

export function getMyDrawItCustomWords(session, localAuthor, localAuthorUid) {
  const me = localAuthor ?? getLocalDisplayName();
  return getDrawItCustomWords(session).filter(
    (item) =>
      Boolean(item.text) && isDrawItCustomWordOwnedBy(item, me, localAuthorUid)
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
    if (code.includes(DRAW_IT_CUSTOM_LOCKED)) {
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
    if (code.includes(DRAW_IT_CUSTOM_LOCKED)) {
      return { ok: false, error: "La partie a déjà commencé." };
    }
    return { ok: false, error: e?.message || "Impossible de supprimer le mot." };
  }
}

export function drawItCatalogPoolSize(categoryId = DRAW_IT_CATALOG_ID, words = DRAW_IT_WORDS) {
  return distinctCatalogPool(categoryId, words).length;
}

/** Purge table privée. No-op si SQL 10 n'est pas encore appliquée. */
export async function clearRemoteDrawItCustomWords() {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return;
  try {
    const { isSupabaseConfigured } = await import("./supabaseClient.js");
    if (!isSupabaseConfigured()) return;
    const { rpcClearDrawItCustomWords } = await import("./gameSessionRpc.js");
    await rpcClearDrawItCustomWords({ lobbyId });
  } catch {
    /* migration 10 optionnelle */
  }
}
