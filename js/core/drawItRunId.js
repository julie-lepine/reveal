/** Identifiant de partie Draw it ! (stable pour toute la run, anti-stale hydrate). */
export function createDrawItRunId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `drawit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
