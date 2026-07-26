/**
 * ARCH-06 — lifecycle de mount (modes B + C).
 *
 * Mode B : `isMounted()` / `dispose()` — vivacité locale après cleanup.
 * Mode C : génération module + `isCurrentMount()` — instance encore active
 *          après remount / nested redirect (même screenId).
 *
 * Le compteur vit ICI. Le routeur signale via `advanceMountGeneration()`.
 * Ce module n'importe PAS le routeur (dépendance unidirectionnelle).
 *
 * Usage (après await / en tête de listener) :
 *   if (!mount.isMounted()) return;
 *   if (!mount.isCurrentMount()) return;
 *   // ou : if (rejectIfStaleMount(mount)) return;
 *
 * Un commit serveur déjà parti n'est pas annulé.
 */

let mountGeneration = 0;

/**
 * Signal routeur : une nouvelle instance de screen va être montée.
 * À appeler après cleanup, immédiatement avant `screens[id](app)`.
 */
export function advanceMountGeneration() {
  mountGeneration += 1;
  return mountGeneration;
}

/** @internal tests / diagnostics uniquement — interdite dans js/games. */
export function getMountGenerationForTests() {
  return mountGeneration;
}

/** @internal tests — réinitialise le compteur (ex. avec resetNav). */
export function resetMountGenerationForTests() {
  mountGeneration = 0;
}

/**
 * True si le mount a été nettoyé OU n'est plus l'instance active.
 * Enchaîne les deux gardes sans fusionner leur sémantique.
 */
export function rejectIfStaleMount(mount) {
  if (!mount?.isMounted?.()) return true;
  if (!mount?.isCurrentMount?.()) return true;
  return false;
}

/**
 * @returns {{
 *   isMounted: () => boolean,
 *   isCurrentMount: () => boolean,
 *   dispose: () => void,
 *   alive: boolean,
 * }}
 */
export function createMountGuard() {
  let alive = true;
  const capturedGeneration = mountGeneration;
  return {
    get alive() {
      return alive;
    },
    isMounted() {
      return alive;
    },
    isCurrentMount() {
      return alive && capturedGeneration === mountGeneration;
    },
    dispose() {
      alive = false;
    },
  };
}
