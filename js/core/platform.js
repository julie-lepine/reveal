/** Détection plateforme sans import statique @capacitor/core (compatible web GitHub Pages). */

export function getCapacitor() {
  return typeof window !== "undefined" ? window.Capacitor : undefined;
}

function uaLooksCapacitor() {
  const ua =
    (typeof navigator !== "undefined" && navigator.userAgent) ||
    (typeof window !== "undefined" && window.navigator?.userAgent) ||
    "";
  return /Capacitor/i.test(ua);
}

export function isNativeApp() {
  const capacitor = getCapacitor();
  if (capacitor?.isNativePlatform?.() === true) return true;
  const platform = capacitor?.getPlatform?.();
  if (platform === "ios" || platform === "android") return true;
  return uaLooksCapacitor();
}

export function getNativePlatform() {
  const platform = getCapacitor()?.getPlatform?.();
  if (platform === "ios" || platform === "android") return platform;
  if (!isNativeApp()) return "web";
  const ua =
    (typeof navigator !== "undefined" && navigator.userAgent) || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod|ios/i.test(ua)) return "ios";
  return platform || "web";
}
