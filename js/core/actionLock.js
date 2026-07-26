/**
 * Verrou logique d'action (survit au re-render / re-bind DOM).
 *
 * Un second `run` pendant que le premier est encore en cours est ignoré
 * (`{ ok: false, skipped: true }`). Le verrou est toujours libéré dans `finally`
 * (succès, retour normal, ou rejet).
 *
 * Usage : `const lock = createActionLock(); await lock.run(async () => { ... })`.
 */
export function createActionLock() {
  let inFlight = false;
  return {
    get inFlight() {
      return inFlight;
    },
    async run(fn) {
      if (inFlight) return { ok: false, skipped: true };
      inFlight = true;
      try {
        const value = await fn();
        return { ok: true, value };
      } finally {
        inFlight = false;
      }
    },
  };
}

/**
 * Anti double-clic pour les boutons critiques (manche suivante, révéler…).
 *
 * Enveloppe un handler de `click` afin d'empêcher toute exécution concurrente
 * (un second clic pendant que le premier est encore en cours est ignoré) et de
 * désactiver visuellement le bouton cliqué le temps de l'action.
 *
 * Si `lock` est fourni, la même instance doit être réutilisée à chaque re-bind
 * après `innerHTML` — sinon un bouton recréé aurait un verrou neuf et
 * réentrerait pendant l'`await`.
 *
 * Usage :
 *   `el.addEventListener("click", withClickLock(async () => { ... }))`
 *   `el.addEventListener("click", withClickLock(handler, { lock: sharedLock }))`
 */
export function withClickLock(handler, { lock } = {}) {
  const actionLock = lock || createActionLock();
  return async function lockedClickHandler(event) {
    const target = event && event.currentTarget;
    const btn =
      target &&
      typeof HTMLElement !== "undefined" &&
      target instanceof HTMLElement
        ? target
        : null;
    const outcome = await actionLock.run(async () => {
      if (btn) btn.disabled = true;
      try {
        return await handler.call(this, event);
      } finally {
        // Après l'action, un re-render remplace souvent le bouton (déconnecté du DOM) :
        // on ne réactive que s'il est toujours présent.
        if (btn && btn.isConnected) btn.disabled = false;
      }
    });
    return outcome.ok ? outcome.value : undefined;
  };
}
