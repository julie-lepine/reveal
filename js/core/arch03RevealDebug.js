/**
 * TEMP ARCH-03 — traçage flux « Révéler maintenant » / acting host play.
 * Filtrer la console : ARCH03-REVEAL
 * À retirer après QA.
 */
export const ARCH03_REVEAL_DEBUG = true;

export function arch03RevealLog(step, data = undefined) {
  if (!ARCH03_REVEAL_DEBUG) return;
  if (data === undefined) {
    console.info(`[ARCH03-REVEAL] ${step}`);
    return;
  }
  console.info(`[ARCH03-REVEAL] ${step}`, data);
}
