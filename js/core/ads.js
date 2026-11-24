import { isNativeApp, getNativePlatform } from "./platform.js";
import { loadCapacitorAdMob } from "./capacitorImports.js";
import { onScreenChange, getCurrentScreen } from "./router.js";
import { isAdFree } from "./entitlements.js";
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

export function shouldShowAdForScreen(screenId) {
  return Boolean(screenId && !NO_AD_SCREENS.has(screenId) && !isAdFree());
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

/** Délai minimum entre deux essais de consentement ratés (hors ligne au lancement…). */
const CONSENT_RETRY_MS = 30_000;

/** Dernier état connu du consentement Google (UMP), pour ce lancement. */
let consentState = { known: false, canRequestAds: false, privacyOptionsRequired: false };
let lastConsentFailureAt = 0;
const consentListeners = new Set();

function applyConsentInfo(info) {
  if (!info || typeof info !== "object") return;
  const next = {
    known: true,
    canRequestAds:
      typeof info.canRequestAds === "boolean" ? info.canRequestAds : consentState.canRequestAds,
    privacyOptionsRequired:
      typeof info.privacyOptionsRequirementStatus === "string"
        ? info.privacyOptionsRequirementStatus === "REQUIRED"
        : consentState.privacyOptionsRequired,
  };
  const changed =
    next.known !== consentState.known ||
    next.canRequestAds !== consentState.canRequestAds ||
    next.privacyOptionsRequired !== consentState.privacyOptionsRequired;
  consentState = next;
  if (!changed) return;
  for (const cb of consentListeners) {
    try {
      cb({ ...consentState });
    } catch (err) {
      console.warn("AdMob consent listener:", err);
    }
  }
}

/** Google a donné son feu vert pour demander des pubs (après la demande de ce lancement). */
export function adConsentAllowsAds() {
  return consentState.known && consentState.canRequestAds;
}

/** Le bouton « Choix publicitaires » doit être visible (Europe, appli native). */
export function adPrivacyOptionsRequired() {
  return isNativeApp() && consentState.privacyOptionsRequired;
}

/** Abonnement aux changements de consentement. Retourne la fonction de désabonnement. */
export function onAdConsentChange(cb) {
  consentListeners.add(cb);
  return () => consentListeners.delete(cb);
}

/**
 * Demande le consentement Google (formulaire si requis).
 * true = on peut demander des pubs ; false = pas de pub pour l'instant (réessai plus tard).
 */
async function ensureConsent(AdMob, AdmobConsentStatus) {
  try {
    const info = await AdMob.requestConsentInfo();
    applyConsentInfo(info);
    if (
      info?.isConsentFormAvailable &&
      info?.status === AdmobConsentStatus.REQUIRED
    ) {
      const after = await AdMob.showConsentForm();
      applyConsentInfo(after);
    }
    return adConsentAllowsAds();
  } catch (err) {
    console.warn("AdMob consent:", err);
    return false;
  }
}

/** Popup système Apple (iPhone / iPad). Après UMP s'il s'affiche, avant les bannières. */
async function ensureTrackingAuthorization(AdMob) {
  if (getNativePlatform() !== "ios") return;
  if (typeof AdMob.trackingAuthorizationStatus !== "function") return;
  if (typeof AdMob.requestTrackingAuthorization !== "function") return;
  try {
    const info = await AdMob.trackingAuthorizationStatus();
    if (info?.status === "notDetermined") {
      await AdMob.requestTrackingAuthorization();
    }
  } catch (err) {
    console.warn("REVEAL ATT:", err);
  }
}

let sdkStarted = false;
let trackingAsked = false;

/**
 * Démarre le plugin (une fois), puis consentement Google, puis demande Apple.
 * Sur iOS le plugin exige `initialize` avant le formulaire (il y relie la vue).
 * Aucune pub n'est demandée tant que Google n'a pas dit oui (`canRequestAds`).
 * true = pubs autorisées. false = pas maintenant ; réessai au prochain écran (30 s mini).
 */
async function ensureAdMobReady() {
  if (!isNativeApp()) return false;
  if (initialized) return true;
  if (initPromise) return initPromise;
  if (lastConsentFailureAt && Date.now() - lastConsentFailureAt < CONSENT_RETRY_MS) {
    return false;
  }

  initPromise = (async () => {
    try {
      const mod = await loadAdMobModule();
      if (!mod) return false;

      const { AdMob, BannerAdPluginEvents, AdmobConsentStatus } = mod;

      if (!sdkStarted) {
        await AdMob.initialize({
          initializeForTesting: ADMOB_USE_TEST_ADS,
        });

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
        sdkStarted = true;
      }

      const allowed = await ensureConsent(AdMob, AdmobConsentStatus);

      if (!trackingAsked && consentState.known) {
        trackingAsked = true;
        await ensureTrackingAuthorization(AdMob);
      }

      if (!allowed) {
        lastConsentFailureAt = Date.now();
        return false;
      }

      lastConsentFailureAt = 0;
      initialized = true;
      return true;
    } catch (err) {
      console.warn("AdMob init:", err);
      lastConsentFailureAt = Date.now();
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Rouvre le formulaire Google « Choix publicitaires » (bouton Aide & légal).
 * Relit ensuite l'état et resynchronise la bannière.
 */
export async function openAdPrivacyOptions() {
  if (!isNativeApp()) return { ok: false };
  try {
    const mod = await loadAdMobModule();
    if (!mod) return { ok: false };
    const { AdMob } = mod;
    if (!sdkStarted) {
      await ensureAdMobReady();
    }
    if (!sdkStarted) return { ok: false };
    await AdMob.showPrivacyOptionsForm();
    try {
      applyConsentInfo(await AdMob.requestConsentInfo());
    } catch (err) {
      console.warn("AdMob consent refresh:", err);
    }
    if (!adConsentAllowsAds()) {
      initialized = false;
    }
    enqueueAdSync(getCurrentScreen());
    return { ok: true };
  } catch (err) {
    console.warn("AdMob privacy options:", err);
    return { ok: false };
  }
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
  const mod = await loadAdMobModule();
  if (!mod) return;
  const { AdMob, BannerAdSize, BannerAdPosition } = mod;

  if (!ready) {
    // Pas de feu vert Google : aucune bannière (et retirer celle d'avant s'il y en a une).
    setTopAdLayout(false);
    if (bannerVisible) await removeBannerIfPresent(AdMob);
    return;
  }
  if (!shouldShowAdForScreen(getCurrentScreen())) return;

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

/** Rejouer le sync bannière après un changement d’entitlement (login, SQL, plus tard IAP). */
export function refreshAdsForEntitlement() {
  if (!isNativeApp()) return;
  enqueueAdSync(getCurrentScreen());
}

export function initAds() {
  if (!isNativeApp()) return;

  document.documentElement.style.setProperty("--ad-banner-buffer", "0px");

  onScreenChange((screenId) => {
    enqueueAdSync(screenId);
  });

  enqueueAdSync(getCurrentScreen());
}
