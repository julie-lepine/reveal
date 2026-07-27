/**
 * ARCH-22 — pending sync visible après délai soft.
 *
 * Gère uniquement : soft delay, tokens, timers, cleanup.
 * Pas de libellés, DOM, locks métier, réseau ni alertes.
 */

export const DEFAULT_SYNC_PENDING_SOFT_MS = 500;

/**
 * @param {{
 *   softDelayMs?: number,
 *   onChange?: (state: { visible: boolean, token: number|null }) => void,
 * }} [options]
 */
export function createSyncPending({
  softDelayMs = DEFAULT_SYNC_PENDING_SOFT_MS,
  onChange,
} = {}) {
  let seq = 0;
  /** @type {number|null} */
  let currentToken = null;
  let visible = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timerId = null;
  let disposed = false;

  function snapshot() {
    return { visible, token: currentToken };
  }

  function notify() {
    if (disposed) return;
    if (typeof onChange !== "function") return;
    onChange(snapshot());
  }

  function clearTimer() {
    if (timerId == null) return;
    clearTimeout(timerId);
    timerId = null;
  }

  /**
   * Démarre un nouveau cycle. Annule le précédent.
   * @returns {number|null} token opaque, ou null si disposed
   */
  function start() {
    if (disposed) return null;

    clearTimer();
    seq += 1;
    const token = seq;
    currentToken = token;
    visible = false;
    notify();

    const delay = Math.max(0, Number(softDelayMs) || 0);
    timerId = setTimeout(() => {
      timerId = null;
      if (disposed) return;
      if (currentToken !== token) return;
      visible = true;
      notify();
    }, delay);

    return token;
  }

  /**
   * Termine le cycle courant si `token` correspond.
   * @param {number|null|undefined} token
   */
  function end(token) {
    if (disposed) return;
    if (token == null || token !== currentToken) return;

    clearTimer();
    currentToken = null;
    visible = false;
    notify();
  }

  /** @returns {{ visible: boolean, token: number|null }} */
  function getState() {
    return snapshot();
  }

  /** Idempotent — gèle timers et callbacks. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimer();
    currentToken = null;
    visible = false;
  }

  return { start, end, getState, dispose };
}
