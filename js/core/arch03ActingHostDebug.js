/**
 * Diagnostic acting-host UI (ARCH-03).
 * Activation : localStorage.setItem('reveal-acting-host-debug','1')
 * Filtrer la console : ARCH03-AH
 */
export const ACTING_HOST_DEBUG_KEY = "reveal-acting-host-debug";

export function actingHostDebugEnabled() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(ACTING_HOST_DEBUG_KEY) === "1"
    );
  } catch {
    return false;
  }
}

/** @deprecated Use actingHostDebugEnabled() */
export function isArch03AhDebug() {
  return actingHostDebugEnabled();
}

export function arch03AhLog(step, data = undefined) {
  if (!actingHostDebugEnabled()) return;
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
