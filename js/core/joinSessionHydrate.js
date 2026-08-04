/**
 * T-01 / T-02 - hydrate session au join avant sync/Realtime route.
 * Purs / testables (sans Supabase).
 */

/** Délais restore après join (pas de tentative à 0 ms). */
export const JOIN_SESSION_RESTORE_DELAYS_MS = Object.freeze([100, 350, 800, 1500]);

/** Catch-up SUBSCRIBED uniquement - pas les events INSERT/UPDATE normaux. */
export const SUBSCRIBED_ROUTE_DEBOUNCE_MS = 300;

/**
 * Ordre critique join/create/recovery.
 * @returns {readonly ['restoreActiveGameSession', 'startMultiplayerSync']}
 */
export function planLobbyJoinSyncOrder() {
  return Object.freeze(["restoreActiveGameSession", "startMultiplayerSync"]);
}

/**
 * Pendant l'hydrate join, le catch-up SUBSCRIBED ne doit pas router.
 * @param {{ joinSessionHydrating: boolean }} opts
 */
export function shouldRouteAfterRealtimeSubscribed({ joinSessionHydrating }) {
  return !joinSessionHydrating;
}

/**
 * Debounce coalescé (génération) pour un callback à 1 argument.
 * @template T
 * @param {(arg: T) => void} fn
 * @param {number} delayMs
 */
export function createDebouncedCallback(fn, delayMs) {
  let timer = null;
  let generation = 0;
  return {
    schedule(arg) {
      generation += 1;
      const gen = generation;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (gen !== generation) return;
        fn(arg);
      }, delayMs);
    },
    cancel() {
      generation += 1;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
