/**
 * Anti double-clic pour les boutons critiques (manche suivante, révéler…).
 *
 * Enveloppe un handler de `click` afin d'empêcher toute exécution concurrente
 * (un second clic pendant que le premier est encore en cours est ignoré) et de
 * désactiver visuellement le bouton cliqué le temps de l'action. Sans ça, un
 * double-clic rapide pouvait sauter une manche ou déclencher deux clôtures.
 *
 * Usage : `el.addEventListener("click", withClickLock(async () => { ... }))`.
 */
export function withClickLock(handler) {
  let inFlight = false;
  return async function lockedClickHandler(event) {
    if (inFlight) return undefined;
    inFlight = true;
    const btn =
      event && event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (btn) btn.disabled = true;
    try {
      return await handler.call(this, event);
    } finally {
      inFlight = false;
      // Après l'action, un re-render remplace souvent le bouton (déconnecté du DOM) :
      // on ne réactive que s'il est toujours présent.
      if (btn && btn.isConnected) btn.disabled = false;
    }
  };
}
