/** Détection plateforme sans import statique @capacitor/core (compatible web GitHub Pages). */

export function getCapacitor() {
  return typeof window !== "undefined" ? window.Capacitor : undefined;
}

export function isNativeApp() {
  const capacitor = getCapacitor();
  const native = capacitor?.isNativePlatform?.() === true;

  console.log("[REVEAL PLATFORM]", {
    hasCapacitor: Boolean(capacitor),
    native,
    platform: capacitor?.getPlatform?.() || "web",
  });

  return native;
}

export function getNativePlatform() {
  return getCapacitor()?.getPlatform?.() || "web";
}
