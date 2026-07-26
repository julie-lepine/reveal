/**
 * ARCH-06 Vague B — garde de vivacité d'un mount (effets UI / navigate après unmount).
 *
 * Ne gère ni timers, ni listeners, ni erreurs. Le cleanup de l'écran reste
 * responsable de `dispose()` + unsub + clearTimeout/RAF.
 *
 * Usage :
 *   const mount = createMountGuard();
 *   await doCommit();           // commit serveur peut finir
 *   if (!mount.isMounted()) return;
 *   render();                   // effet UI seulement si encore monté
 *   return () => { mount.dispose(); unsub(); };
 */
export function createMountGuard() {
  let alive = true;
  return {
    get alive() {
      return alive;
    },
    isMounted() {
      return alive;
    },
    dispose() {
      alive = false;
    },
  };
}
