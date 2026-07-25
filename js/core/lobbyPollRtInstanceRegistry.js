/**
 * Registre diagnostic multi-instances Realtime polls.
 * Vit sur globalThis pour survivre à plusieurs évaluations de module.
 * Aucun rôle fonctionnel — activé uniquement si reveal-poll-rt-debug=1.
 */

export const POLL_RT_DEBUG_KEY = "reveal-poll-rt-debug";
export const POLL_RT_REGISTRY_KEY = "__REVEAL_POLL_RT_INSTANCES__";

export function pollRtInstanceDebugEnabled() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(POLL_RT_DEBUG_KEY) === "1"
    );
  } catch {
    return false;
  }
}

/** Id stable cross-graphe : timestamp + aléatoire (pas un compteur local). */
export function makePollRtInstanceId(kind) {
  const t =
    typeof performance !== "undefined" && performance.now
      ? `${Date.now().toString(36)}_${Math.floor(performance.now()).toString(36)}`
      : Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${kind}_${t}_${r}`;
}

/**
 * @returns {{
 *   bootAt: number,
 *   entries: Record<string, object>,
 * }}
 */
export function getPollRtInstanceRegistry() {
  const g = globalThis;
  if (!g[POLL_RT_REGISTRY_KEY] || typeof g[POLL_RT_REGISTRY_KEY] !== "object") {
    g[POLL_RT_REGISTRY_KEY] = {
      bootAt: Date.now(),
      entries: Object.create(null),
    };
  }
  return g[POLL_RT_REGISTRY_KEY];
}

export function listPollRtRegistryEntries() {
  const reg = getPollRtInstanceRegistry();
  return Object.values(reg.entries || {});
}

export function countPollRtRegistryTotal() {
  return listPollRtRegistryEntries().length;
}

export function countPollRtRegistryActive(lobbyId = null) {
  return listPollRtRegistryEntries().filter((e) => {
    if (!e?.active) return false;
    if (lobbyId == null || lobbyId === "") return true;
    return String(e.lobbyId || "") === String(lobbyId);
  }).length;
}

/**
 * @param {string} entryKey — typiquement controllerId
 * @param {object} patch
 */
export function upsertPollRtRegistryEntry(entryKey, patch = {}) {
  if (!pollRtInstanceDebugEnabled() || !entryKey) return null;
  const reg = getPollRtInstanceRegistry();
  const prev = reg.entries[entryKey] || {};
  const next = {
    ...prev,
    ...patch,
    entryKey,
    updatedAt: Date.now(),
  };
  if (next.createdAt == null) next.createdAt = Date.now();
  if (next.active == null) next.active = true;
  reg.entries[entryKey] = next;
  return next;
}

export function markPollRtRegistryDisposed(entryKey, extra = {}) {
  if (!pollRtInstanceDebugEnabled() || !entryKey) return;
  upsertPollRtRegistryEntry(entryKey, {
    ...extra,
    active: false,
    disposedAt: Date.now(),
    status: extra.status ?? "disposed",
  });
}

/**
 * Indices d'origine module (preuve multi-URL / multi-chargement).
 * @param {string|null|undefined} importMetaUrl
 */
export function collectPollRtModuleOrigin(importMetaUrl) {
  const origin = {
    importMetaUrl: importMetaUrl || null,
    documentCurrentScriptSrc: null,
    moduleScriptSrcs: [],
    resourceUrlsMatchingPoll: [],
  };
  try {
    if (typeof document !== "undefined") {
      origin.documentCurrentScriptSrc =
        document.currentScript?.src || null;
      origin.moduleScriptSrcs = [...document.querySelectorAll("script[type=module]")]
        .map((s) => s.getAttribute("src") || s.src || null)
        .filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof performance !== "undefined" && performance.getEntriesByType) {
      const entries = performance.getEntriesByType("resource") || [];
      origin.resourceUrlsMatchingPoll = entries
        .map((e) => e.name)
        .filter(
          (u) =>
            typeof u === "string" &&
            (u.includes("lobbyPollStore") ||
              u.includes("lobbyPollChannel") ||
              u.includes("lobbyPollRtInstanceRegistry") ||
              u.includes("/main.js"))
        );
    }
  } catch {
    /* ignore */
  }
  return origin;
}

/**
 * Log diagnostic instance — debug only.
 * @param {string} event
 * @param {object} payload
 */
export function logPollRtInstance(event, payload = {}) {
  if (!pollRtInstanceDebugEnabled()) return;
  const lobbyId = payload.lobbyId ?? null;
  console.info(`[POLL-RT] ${event}`, {
    ...payload,
    registryTotal: countPollRtRegistryTotal(),
    registryActive: countPollRtRegistryActive(null),
    registryActiveForLobby: countPollRtRegistryActive(lobbyId),
  });
}
