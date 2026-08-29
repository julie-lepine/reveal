/**
 * Splash Capacitor : le plugin masque tout seul après launchShowDuration.
 * On le cache plus tôt dès qu’un écran est peint, pour éviter le fond #0A0F1C
 * (écran bleu) si le boot JS est lent.
 */
import { getCapacitor, isNativeApp } from "./platform.js";

const SAFETY_HIDE_MS = 6_000;

let hideStarted = false;
let safetyTimer = null;

async function hideViaBridge() {
  const plugin = getCapacitor()?.Plugins?.SplashScreen;
  if (typeof plugin?.hide !== "function") return false;
  await plugin.hide({ fadeOutDuration: 300 });
  return true;
}

export async function hideNativeSplash() {
  if (!isNativeApp() || hideStarted) return;
  hideStarted = true;
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  try {
    if (await hideViaBridge()) return;
    const { loadCapacitorSplashScreen } = await import("./capacitorImports.js");
    const mod = await loadCapacitorSplashScreen();
    await mod?.SplashScreen?.hide?.({ fadeOutDuration: 300 });
  } catch (e) {
    console.warn("REVEAL splash hide:", e?.message || e);
  }
}

/** Filet : si boot bloque, ne pas rester sur le splash / fond bleu indéfiniment. */
export function armNativeSplashSafetyHide() {
  if (!isNativeApp() || safetyTimer || hideStarted) return;
  safetyTimer = setTimeout(() => {
    safetyTimer = null;
    void hideNativeSplash();
  }, SAFETY_HIDE_MS);
}
