/**
 * M-04b / SYN-18 — timeout de patch sync avec clear du timer.
 * Pur / testable (sans gameSync ni Supabase).
 */
import { SYNC_PATCH_TIMEOUT_MS } from "../config/syncConfig.js";

/**
 * @param {Promise<any>} promise Promesse déjà démarrée (pas une factory).
 * @param {number} [ms]
 * @param {string} [message]
 * @returns {Promise<any>}
 */
export function withPatchTimeout(
  promise,
  ms = SYNC_PATCH_TIMEOUT_MS,
  message
) {
  if (!ms || ms <= 0) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(message || "Synchronisation trop longue.")),
        ms
      );
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}
