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
  // Normalise pour pouvoir attacher un catch orphelin après un timeout gagnant.
  const tracked = Promise.resolve(promise);
  return Promise.race([
    tracked,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(message || "Synchronisation trop longue.")),
        ms
      );
    }),
  ]).finally(() => {
    clearTimeout(timer);
    // Si le timeout gagne, le fetch sous-jacent peut encore rejeter plus tard
    // (ex. NetworkError hors ligne). Sans observateur → Uncaught (in promise)
    // attribué au await UI (speedVote.js:330). On consomme ce rejet tardif ici.
    tracked.catch(() => {});
  });
}
