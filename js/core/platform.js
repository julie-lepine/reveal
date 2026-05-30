/** Détection plateforme sans import statique @capacitor/core (compatible web GitHub Pages). */

export function getCapacitor() {
  return typeof window !== "undefined" ? window.Capacitor : undefined;
}

export function isNativeApp() {
  return getCapacitor()?.isNativePlatform?.() === true;
}

export function getNativePlatform() {
  return getCapacitor()?.getPlatform?.() || "web";
}
