/**
 * FEATURE-ADFREE-02A — socle RevenueCat (natif Android).
 *
 * Cette étape prépare uniquement le plugin. Elle ne configure pas le SDK,
 * n’achète pas, ne restaure pas, n’identifie pas l’utilisateur RevenueCat
 * et n’écrit pas le flag Sans pub côté profil.
 *
 * Ne pas importer ce module depuis main.js tant que 02B n’est pas ouvert.
 */
import { isNativeApp, getNativePlatform } from "./platform.js";
import { REVENUECAT_ANDROID_PUBLIC_SDK_KEY } from "../../data/revenueCatConfig.js";

export function isRevenueCatAndroidPublicSdkKeyReady() {
  const key = REVENUECAT_ANDROID_PUBLIC_SDK_KEY;
  return (
    typeof key === "string" &&
    key.startsWith("appl_") &&
    !key.includes("REPLACE") &&
    key.length > 8
  );
}

export function isPurchasesNativeReady() {
  return isNativeApp() && getNativePlatform() === "android";
}

/** Charge le module JS du plugin. Ne configure pas le SDK et n’achète rien. */
export async function loadPurchasesPlugin() {
  if (!isPurchasesNativeReady()) return null;
  const { loadRevenueCatPurchases } = await import("./capacitorImports.js");
  return loadRevenueCatPurchases();
}
