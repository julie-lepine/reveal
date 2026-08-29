/**
 * Plugins Capacitor via le pont natif (`window.Capacitor`).
 * Les imports CDN bloqués figent l’écran de démarrage sur Android.
 */
import { getCapacitor, isNativeApp } from "./platform.js";

export const BannerAdSize = Object.freeze({
  BANNER: "BANNER",
  FULL_BANNER: "FULL_BANNER",
  LARGE_BANNER: "LARGE_BANNER",
  MEDIUM_RECTANGLE: "MEDIUM_RECTANGLE",
  LEADERBOARD: "LEADERBOARD",
  ADAPTIVE_BANNER: "ADAPTIVE_BANNER",
  SMART_BANNER: "SMART_BANNER",
});

export const BannerAdPosition = Object.freeze({
  TOP_CENTER: "TOP_CENTER",
  CENTER: "CENTER",
  BOTTOM_CENTER: "BOTTOM_CENTER",
});

export const BannerAdPluginEvents = Object.freeze({
  SizeChanged: "bannerAdSizeChanged",
  Loaded: "bannerAdLoaded",
  FailedToLoad: "bannerAdFailedToLoad",
  Opened: "bannerAdOpened",
  Closed: "bannerAdClosed",
  AdImpression: "bannerAdImpression",
});

export const AdmobConsentStatus = Object.freeze({
  NOT_REQUIRED: "NOT_REQUIRED",
  OBTAINED: "OBTAINED",
  REQUIRED: "REQUIRED",
  UNKNOWN: "UNKNOWN",
});

function nativePlugin(name) {
  const cap = getCapacitor();
  if (!cap) return null;
  try {
    if (typeof cap.registerPlugin === "function") {
      return cap.registerPlugin(name);
    }
  } catch {
    /* déjà enregistré */
  }
  return cap.Plugins?.[name] || null;
}

export async function loadCapacitorApp() {
  if (!isNativeApp()) return null;
  const App = nativePlugin("App");
  return App ? { App } : null;
}

export async function loadCapacitorBrowser() {
  if (!isNativeApp()) return null;
  const Browser = nativePlugin("Browser");
  return Browser ? { Browser } : null;
}

export async function loadCapacitorAdMob() {
  if (!isNativeApp()) return null;
  const AdMob = nativePlugin("AdMob");
  if (!AdMob) return null;
  return {
    AdMob,
    BannerAdSize,
    BannerAdPosition,
    BannerAdPluginEvents,
    AdmobConsentStatus,
  };
}

export async function loadRevenueCatPurchases() {
  if (!isNativeApp()) return null;
  const Purchases = nativePlugin("Purchases");
  return Purchases ? { Purchases } : null;
}

export async function loadCapacitorSplashScreen() {
  if (!isNativeApp()) return null;
  const SplashScreen = nativePlugin("SplashScreen");
  return SplashScreen ? { SplashScreen } : null;
}
