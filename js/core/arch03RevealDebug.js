/**
 * Diagnostic flux « Révéler maintenant » / acting host play (ARCH-03).
 * Activation : localStorage.setItem('reveal-acting-host-debug','1')
 * Filtrer la console : ARCH03-REVEAL
 */
import { actingHostDebugEnabled } from "./arch03ActingHostDebug.js";

export function arch03RevealLog(step, data = undefined) {
  if (!actingHostDebugEnabled()) return;
  if (data === undefined) {
    console.info(`[ARCH03-REVEAL] ${step}`);
    return;
  }
  console.info(`[ARCH03-REVEAL] ${step}`, data);
}
