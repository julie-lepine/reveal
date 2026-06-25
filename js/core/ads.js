import { isNativeApp, getNativePlatform } from "./platform.js";
import { loadCapacitorAdMob } from "./capacitorImports.js";
import { onScreenChange, getCurrentScreen } from "./router.js";
import {
  ADMOB_BANNER_IDS,
  ADMOB_TEST_BANNER_IDS,
  ADMOB_USE_TEST_ADS,
  ADMOB_DEFAULT_BANNER_HEIGHT,
  ADMOB_BANNER_BUFFER,
} from "../../data/admobConfig.js";

let initialized = false;
let bannerVisible = false;
let initPromise = null;
let admobModule = null;
let lastSyncedAdScreen = null;
let adSyncChain = Promise.resolve();
let lastBannerHeightPx = ADMOB_DEFAULT_BANNER_HEIGHT;

/** Écrans sans bannière (accueil, connexion, reset MDP). Layout via body.has-top-ad ailleurs. */
const NO_AD_SCREENS = new Set(["welcome", "home", "reset-password"]);

function shouldShowAdForScreen(screenId) {
  return Boolean(screenId && !NO_AD_SCREENS.has(screenId));
}

/** Estimation hauteur bannière adaptive (formule Google ~16,4 % de la largeur, plafond 90). */
function estimateAdaptiveBannerHeight() {
  const w = Math.min(Math.max(window.innerWidth || 430, 320), 728);
  return Math.min(Math.max(Math.round(w * 0.164), ADMOB_DEFAULT_BANNER_HEIGHT), 90);
}

/** Normalise la hauteur renvoyée par le SDK en px CSS. */
function cssBannerHeight(rawHeight) {
  if (rawHeight == null || rawHeight <= 0) {
    return lastBannerHeightPx >= ADMOB_DEFAULT_BANNER_HEIGHT
      ? lastBannerHeightPx
      : estimateAdaptiveBannerHeight();
  }

  let h = Math.round(Number(rawHeight));
  const dpr = window.devicePixelRatio || 1;

  // Android : le plugin peut renvoyer des px physiques (valeur très élevée).
  if (getNativePlatform() === "android" && dpr > 1 && h >= 100) {
    const asCss = Math.round(h / dpr);
    if (asCss >= 40 && asCss <= 120) h = asCss;
  }

  return Math.min(Math.max(h, 50), 120);
}

function setTopAdLayout(active, heightPx) {
  document.documentElement.style.setProperty(
    "--ad-banner-buffer",
    active ? `${ADMOB_BANNER_BUFFER}px` : "0px"
  );

  if (!active) {
    document.body.classList.remove("has-top-ad");
    document.documentElement.style.setProperty("--ad-banner-height", "0px");
    return;
  }

  const h = cssBannerHeight(heightPx);
  lastBannerHeightPx = h;
  document.body.classList.add("has-top-ad");
  document.documentElement.style.setProperty("--ad-banner-height", `${h}px`);
}

function bannerAdId() {
  const platform = getNativePlatform();
  const ids = ADMOB_USE_TEST_ADS ? ADMOB_TEST_BANNER_IDS : ADMOB_BANNER_IDS;
  if (platform === "ios") return ids.ios;
  if (platform === "android") return ids.android;
  return null;
}

async function loadAdMobModule() {
  if (admobModule) return admobModule;
  admobModule = await loadCapacitorAdMob();
  return admobModule;
}

async function ensureConsent(AdMob, AdmobConsentStatus) {
  try {
    const info = await AdMob.requestConsentInfo();
    if (
      info?.isConsentFormAvailable &&
      info?.status === AdmobConsentStatus.REQUIRED
    ) {
      await AdMob.showConsentForm();
    }
  } catch (err) {
    console.warn("AdMob consent:", err);
  }
}

async function ensureAdMobReady() {
  if (!isNativeApp()) return false;
  if (initialized) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await loadAdMobModule();
      if (!mod) return false;

      const { AdMob, BannerAdPluginEvents, AdmobConsentStatus } = mod;

      await AdMob.initialize({
        initializeForTesting: ADMOB_USE_TEST_ADS,
      });

      await ensureConsent(AdMob, AdmobConsentStatus);

      AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
        if (bannerVisible && size?.height && shouldShowAdForScreen(getCurrentScreen())) {
          setTopAdLayout(true, size.height);
        }
      });

      AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (err) => {
        console.warn("AdMob bannière:", err);
        bannerVisible = false;
        setTopAdLayout(false);
      });

      initialized = true;
      return true;
    } catch (err) {
      console.warn("AdMob init:", err);
      return false;
    }
  })();

  return initPromise;
}

async function removeBannerIfPresent(AdMob) {
  try {
    if (typeof AdMob.removeBanner === "function") {
      await AdMob.removeBanner();
    } else {
      await AdMob.hideBanner();
    }
  } catch {
    /* pas de bannière active */
  }
  bannerVisible = false;
}

async function showTopBanner() {
  if (!isNativeApp()) return;
  const screenId = getCurrentScreen();
  if (!shouldShowAdForScreen(screenId)) return;

  const adId = bannerAdId();
  if (!adId) return;

  const ready = await ensureAdMobReady();
  if (!ready) return;
  if (!shouldShowAdForScreen(getCurrentScreen())) return;

  const mod = await loadAdMobModule();
  if (!mod) return;
  const { AdMob, BannerAdSize, BannerAdPosition } = mod;

  const cameFromNoAd =
    lastSyncedAdScreen != null && !shouldShowAdForScreen(lastSyncedAdScreen);

  try {
    if (bannerVisible && !cameFromNoAd) {
      setTopAdLayout(true, lastBannerHeightPx);
      await AdMob.resumeBanner();
      if (!shouldShowAdForScreen(getCurrentScreen())) {
        await hideTopBanner();
        return;
      }
      setTopAdLayout(true, lastBannerHeightPx);
      return;
    }

    if (bannerVisible || cameFromNoAd) {
      await removeBannerIfPresent(AdMob);
    }

    // Réserver l'espace avant que la bannière native apparaisse (évite le rognage du haut).
    setTopAdLayout(true, estimateAdaptiveBannerHeight());

    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.TOP_CENTER,
      margin: 0,
      isTesting: ADMOB_USE_TEST_ADS,
    });

    if (!shouldShowAdForScreen(getCurrentScreen())) {
      await hideTopBanner();
      return;
    }

    bannerVisible = true;
    setTopAdLayout(true, lastBannerHeightPx);
  } catch (err) {
    console.warn("AdMob showBanner:", err);
    bannerVisible = false;
    setTopAdLayout(false);
  }
}

async function hideTopBanner() {
  setTopAdLayout(false);
  if (!isNativeApp()) {
    bannerVisible = false;
    return;
  }

  try {
    const mod = await loadAdMobModule();
    if (mod) {
      const { AdMob } = mod;
      await ensureAdMobReady();
      await removeBannerIfPresent(AdMob);
    }
  } catch (err) {
    console.warn("AdMob hide:", err);
  } finally {
    bannerVisible = false;
  }
}

async function syncAdForScreen(screenId) {
  if (!isNativeApp()) return;
  lastSyncedAdScreen = screenId;
  if (shouldShowAdForScreen(screenId)) {
    await showTopBanner();
  } else {
    await hideTopBanner();
  }
}

function enqueueAdSync(screenId) {
  adSyncChain = adSyncChain
    .then(() => syncAdForScreen(screenId))
    .catch((err) => console.warn("AdMob sync:", err));
}

export function initAds() {
  if (!isNativeApp()) return;

  document.documentElement.style.setProperty("--ad-banner-buffer", "0px");

  onScreenChange((screenId) => {
    enqueueAdSync(screenId);
  });

  enqueueAdSync(getCurrentScreen());
}
