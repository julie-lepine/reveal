import { isNativeApp, getNativePlatform } from "./platform.js";
import { loadCapacitorAdMob } from "./capacitorImports.js";
import { onScreenChange, getCurrentScreen } from "./router.js";
import {
  ADMOB_BANNER_IDS,
  ADMOB_TEST_BANNER_IDS,
  ADMOB_USE_TEST_ADS,
  ADMOB_DEFAULT_BANNER_HEIGHT,
} from "../../data/admobConfig.js";

/** Manches actives : pas de pub (UX + clics accidentels). */
const GAMEPLAY_SCREENS = new Set([
  "hottake",
  "speedvote",
  "playlistguess",
  "truthmeter",
  "dilemma",
  "trivia",
  "consensus",
  "guesslie",
  "tiernight",
  "filrouge-mission",
]);

let initialized = false;
let bannerVisible = false;
let initPromise = null;
let admobModule = null;

function shouldShowAdForScreen(screenId) {
  if (!screenId || screenId === "reset-password") return false;
  return !GAMEPLAY_SCREENS.has(screenId);
}

function setTopAdLayout(active, heightPx = ADMOB_DEFAULT_BANNER_HEIGHT) {
  document.body.classList.toggle("has-top-ad", active);
  document.documentElement.style.setProperty(
    "--ad-banner-height",
    active ? `${Math.max(0, Math.round(heightPx))}px` : "0px"
  );
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
        if (bannerVisible && size?.height) {
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

async function showTopBanner() {
  if (!isNativeApp()) return;
  const adId = bannerAdId();
  if (!adId) return;

  const ready = await ensureAdMobReady();
  if (!ready) return;

  const mod = await loadAdMobModule();
  if (!mod) return;
  const { AdMob, BannerAdSize, BannerAdPosition } = mod;

  try {
    if (bannerVisible) {
      await AdMob.resumeBanner();
      setTopAdLayout(true);
      return;
    }

    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.TOP_CENTER,
      margin: 0,
      isTesting: ADMOB_USE_TEST_ADS,
    });
    bannerVisible = true;
    setTopAdLayout(true);
  } catch (err) {
    console.warn("AdMob showBanner:", err);
    bannerVisible = false;
    setTopAdLayout(false);
  }
}

async function hideTopBanner() {
  if (!isNativeApp() || !initialized) {
    setTopAdLayout(false);
    return;
  }

  try {
    const mod = await loadAdMobModule();
    if (!mod) return;
    const { AdMob } = mod;
    if (bannerVisible) {
      await AdMob.hideBanner();
      bannerVisible = false;
    }
  } catch (err) {
    console.warn("AdMob hideBanner:", err);
  } finally {
    setTopAdLayout(false);
  }
}

async function syncAdForScreen(screenId) {
  if (!isNativeApp()) return;
  if (shouldShowAdForScreen(screenId)) {
    await showTopBanner();
  } else {
    await hideTopBanner();
  }
}

export function initAds() {
  if (!isNativeApp()) return;

  onScreenChange((screenId) => {
    void syncAdForScreen(screenId);
  });

  void syncAdForScreen(getCurrentScreen());
}
