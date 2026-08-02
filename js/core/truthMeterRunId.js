/** Identifiant de partie TruthMeter (anti-stale reveal, BUG-TRUTHMETER-01B). */
export function createTruthMeterRunId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `truthmeter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
