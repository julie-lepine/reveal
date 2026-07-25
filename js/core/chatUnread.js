const STORAGE_KEY = "reveal-chat-read-cursors";

/** @typedef {{ at: number, id: string }} ChatReadCursor */

let sheetOpenGetter = () => false;
let changeListeners = new Set();
let unsubBundle = null;
let lastBadgeCount = 0;
/** Fallback Node / hors navigateur. */
let memoryStore = {};

function readStore() {
  if (typeof localStorage === "undefined") {
    return { ...memoryStore };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  if (typeof localStorage === "undefined") {
    memoryStore = { ...store };
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode */
  }
}

/** @internal tests */
export function resetChatUnreadStoreForTests() {
  memoryStore = {};
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  lastBadgeCount = 0;
}

/** Clé stable par soirée : id Supabase, sinon code local. */
export function getChatLobbyKey(lobby) {
  if (!lobby) return null;
  if (lobby.id) return `id:${lobby.id}`;
  if (lobby.code) return `code:${String(lobby.code).toUpperCase()}`;
  return null;
}

export function messageCursorOf(msg) {
  if (!msg) return null;
  const at = Number(msg.at) || 0;
  const id = msg.id != null ? String(msg.id) : "";
  return { at, id };
}

/** Compare deux curseurs / messages : négatif si a < b. */
export function compareChatCursors(a, b) {
  const atA = Number(a?.at) || 0;
  const atB = Number(b?.at) || 0;
  if (atA !== atB) return atA - atB;
  const idA = a?.id != null ? String(a.id) : "";
  const idB = b?.id != null ? String(b.id) : "";
  if (idA === idB) return 0;
  return idA < idB ? -1 : 1;
}

export function isMessageAfterCursor(msg, cursor) {
  if (!cursor) return true;
  return compareChatCursors(messageCursorOf(msg), cursor) > 0;
}

export function isLocalChatMessage(msg, { localUserId = null, localName = "" } = {}) {
  if (!msg) return false;
  if (localUserId && msg.userId && msg.userId === localUserId) return true;
  if (localName && msg.from && msg.from === localName) return true;
  return false;
}

/**
 * Compte les non-lus. Les messages système n'ont pas de type dédié :
 * ils apparaissent comme des messages de l'hôte (from = display_name hôte)
 * et suivent donc les mêmes règles (pas d'incrément pour l'émetteur local).
 */
export function countUnreadMessages(
  messages,
  cursor,
  { localUserId = null, localName = "" } = {}
) {
  if (!Array.isArray(messages) || !messages.length) return 0;
  let n = 0;
  for (const msg of messages) {
    if (isLocalChatMessage(msg, { localUserId, localName })) continue;
    if (isMessageAfterCursor(msg, cursor)) n += 1;
  }
  return n;
}

export function formatUnreadBadge(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return "";
  if (n > 9) return "9+";
  return String(n);
}

export function getReadCursor(lobbyKey) {
  if (!lobbyKey) return null;
  const entry = readStore()[lobbyKey];
  if (!entry || typeof entry !== "object") return null;
  const at = Number(entry.at);
  if (!Number.isFinite(at)) return null;
  return { at, id: entry.id != null ? String(entry.id) : "" };
}

export function setReadCursor(lobbyKey, cursor) {
  if (!lobbyKey || !cursor) return;
  const store = readStore();
  store[lobbyKey] = { at: Number(cursor.at) || 0, id: cursor.id != null ? String(cursor.id) : "" };
  writeStore(store);
}

export function clearReadCursor(lobbyKey) {
  if (!lobbyKey) return;
  const store = readStore();
  if (!(lobbyKey in store)) return;
  delete store[lobbyKey];
  writeStore(store);
}

/** Idempotent : avance le curseur jusqu'au dernier message (ou no-op). */
export function markMessagesRead(messages, lobbyKey) {
  if (!lobbyKey) return null;
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) {
    return getReadCursor(lobbyKey);
  }
  const last = list[list.length - 1];
  const next = messageCursorOf(last);
  const prev = getReadCursor(lobbyKey);
  if (prev && compareChatCursors(next, prev) <= 0) {
    return prev;
  }
  setReadCursor(lobbyKey, next);
  return next;
}

function emitChange(count) {
  lastBadgeCount = count;
  changeListeners.forEach((fn) => {
    try {
      fn(count);
    } catch (e) {
      console.warn("REVEAL chatUnread listener:", e);
    }
  });
}

export function onChatUnreadChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export function getLastUnreadBadgeCount() {
  return lastBadgeCount;
}

/**
 * Recalcule le badge à partir de l'état lobby (imports dynamiques = tests purs OK).
 * Si la sheet est ouverte/visible, marque tout comme lu.
 */
export async function syncChatUnread() {
  const [{ getLobby, getLobbyMessages }, { getLocalDisplayName }, { getSupabaseUserId }] =
    await Promise.all([
      import("./lobby.js"),
      import("./state.js"),
      import("./supabaseAuth.js"),
    ]);

  const lobby = getLobby();
  const key = getChatLobbyKey(lobby);
  if (!key) {
    emitChange(0);
    return 0;
  }
  const messages = getLobbyMessages();
  if (sheetOpenGetter()) {
    markMessagesRead(messages, key);
    emitChange(0);
    return 0;
  }
  const count = countUnreadMessages(messages, getReadCursor(key), {
    localUserId: getSupabaseUserId(),
    localName: getLocalDisplayName(),
  });
  emitChange(count);
  return count;
}

/**
 * @param {{ isChatSheetOpen?: () => boolean }} [opts]
 */
export function initChatUnreadTracking(opts = {}) {
  if (typeof opts.isChatSheetOpen === "function") {
    sheetOpenGetter = opts.isChatSheetOpen;
  }
  if (!unsubBundle) {
    void import("./supabaseLobby.js").then(({ onLobbyBundleUpdated }) => {
      if (unsubBundle) return;
      unsubBundle = onLobbyBundleUpdated(() => {
        void syncChatUnread();
      });
    });
  }
  void syncChatUnread();
  return () => {
    unsubBundle?.();
    unsubBundle = null;
  };
}

/** Appelé après écriture locale (pas de Realtime). */
export function notifyLocalChatMessagesChanged() {
  void syncChatUnread();
}
