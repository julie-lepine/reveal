/**
 * TEMP ARCH-03 — logs diagnostic acting-host UI.
 * Filtrer la console : ARCH03-AH
 * À retirer après QA (ne pas laisser en prod).
 */
export const ARCH03_AH_DEBUG = true;

export function arch03AhLog(step, data = undefined) {
  if (!ARCH03_AH_DEBUG) return;
  if (data === undefined) {
    console.info(`[ARCH03-AH] ${step}`);
    return;
  }
  console.info(`[ARCH03-AH] ${step}`, data);
}

export function arch03AhHostAgeMs(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return null;
  const t = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(t)) return null;
  return now - t;
}

export function arch03AhLogSkipDecision(game, data) {
  arch03AhLog(`shouldSkipFullRender:${game}`, data);
}
