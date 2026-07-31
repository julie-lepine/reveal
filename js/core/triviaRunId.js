/** Identifiant de partie Trivia (anti-stale reveal, BUG-TRIVIA-01B). */
export function createTriviaRunId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `trivia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
