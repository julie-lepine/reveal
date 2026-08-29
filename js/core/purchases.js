/**
 * FEATURE-ADFREE-02B — RevenueCat natif (Play live ; iOS dès que `appl_…` est collée).
 *
 * Le client n’écrit jamais `profiles.ad_free`. Après achat / restore, on relit le profil
 * (webhook service_role).
 */
import { isNativeApp, getNativePlatform } from "./platform.js";
import { getState } from "./state.js";
import {
  REVENUECAT_ANDROID_PUBLIC_SDK_KEY,
  REVENUECAT_IOS_PUBLIC_SDK_KEY,
  PLAY_PRODUCT_ID_AD_FREE,
} from "../../data/revenueCatConfig.js";

let configurePromise = null;
let listenerAttached = false;

export function isPublicSdkKeyReady(key) {
  return (
    typeof key === "string" &&
    (key.startsWith("goog_") || key.startsWith("appl_")) &&
    !key.includes("REPLACE") &&
    key.length > 8
  );
}

export function isRevenueCatAndroidPublicSdkKeyReady() {
  return isPublicSdkKeyReady(REVENUECAT_ANDROID_PUBLIC_SDK_KEY);
}

export function publicSdkKeyForNativePlatform() {
  const platform = getNativePlatform();
  if (platform === "ios") return REVENUECAT_IOS_PUBLIC_SDK_KEY;
  if (platform === "android") return REVENUECAT_ANDROID_PUBLIC_SDK_KEY;
  return "";
}

export function isPurchasesNativeReady() {
  return isNativeApp() && isPublicSdkKeyReady(publicSdkKeyForNativePlatform());
}

export async function loadPurchasesPlugin() {
  if (!isNativeApp()) return null;
  const { loadRevenueCatPurchases } = await import("./capacitorImports.js");
  return loadRevenueCatPurchases();
}

function purchasesApi(mod) {
  return mod?.Purchases || mod?.default?.Purchases || mod?.default || null;
}

function isUserCancelled(err) {
  const code = String(err?.code ?? err?.error?.code ?? "");
  const msg = String(err?.message || err?.error?.message || "");
  return (
    /cancel/i.test(code) ||
    /cancel/i.test(msg) ||
    code === "1" ||
    code === "PURCHASE_CANCELLED"
  );
}

async function refreshAdsQuiet() {
  try {
    const { refreshAdsForEntitlement } = await import("./ads.js");
    refreshAdsForEntitlement();
  } catch {
    /* web */
  }
}

export async function ensurePurchasesConfigured() {
  if (!isPurchasesNativeReady()) return null;
  if (configurePromise) return configurePromise;

  configurePromise = (async () => {
    const mod = await loadPurchasesPlugin();
    const Purchases = purchasesApi(mod);
    if (!Purchases?.configure) {
      throw new Error("RevenueCat indisponible sur cet appareil.");
    }
    await Purchases.configure({ apiKey: publicSdkKeyForNativePlatform() });
    if (!listenerAttached && typeof Purchases.addCustomerInfoUpdateListener === "function") {
      listenerAttached = true;
      Purchases.addCustomerInfoUpdateListener(() => {
        void (async () => {
          const { refreshAdFreeFromServer } = await import("./entitlements.js");
          await refreshAdFreeFromServer();
          await refreshAdsQuiet();
        })();
      });
    }
    return Purchases;
  })().catch((err) => {
    configurePromise = null;
    throw err;
  });

  return configurePromise;
}

/** Lie (ou détache) RevenueCat à l’utilisateur Supabase. Invité = logOut. */
export async function syncPurchasesIdentity() {
  if (!isPurchasesNativeReady()) return;
  try {
    const Purchases = await ensurePurchasesConfigured();
    if (!Purchases) return;
    const user = getState().user || {};
    const userId = getState().supabaseUserId;
    if (!userId || user.isGuest || !user.loggedIn) {
      try {
        await Purchases.logOut();
      } catch {
        /* déjà anonyme */
      }
      return;
    }
    if (typeof Purchases.logIn === "function") {
      await Purchases.logIn({ appUserID: userId });
    }
  } catch (e) {
    console.warn("REVEAL Purchases identity:", e?.message || e);
  }
}

/**
 * Plugin Capacitor v13 : `{ current, all }` à la racine.
 * Certaines versions / wrappers : `{ offerings: { current, all } }`.
 */
export function unwrapOfferings(result) {
  if (!result || typeof result !== "object") return null;
  if (result.current != null || (result.all && typeof result.all === "object")) {
    return result;
  }
  const nested = result.offerings;
  if (nested && typeof nested === "object") return nested;
  return result;
}

function packageForAdFree(offerings) {
  const current = offerings?.current;
  const packages =
    current?.availablePackages ||
    offerings?.all?.default?.availablePackages ||
    [];
  const match = packages.find((pkg) => {
    const id = pkg?.product?.identifier || pkg?.product?.productIdentifier || "";
    return id === PLAY_PRODUCT_ID_AD_FREE || id?.endsWith(PLAY_PRODUCT_ID_AD_FREE);
  });
  return match || packages[0] || current?.lifetime || offerings?.all?.default?.lifetime || null;
}

async function refreshAdFreeAfterStore() {
  const { refreshAdFreeFromServerUntil } = await import("./entitlements.js");
  const on = await refreshAdFreeFromServerUntil(true, { tries: 8, delayMs: 1000 });
  await refreshAdsQuiet();
  return on;
}

export async function purchaseAdFree() {
  if (!isNativeApp()) {
    return {
      ok: false,
      message: "L’achat Sans pub se fait dans l’app Android (ou iOS plus tard), pas sur le web.",
    };
  }
  if (!isPurchasesNativeReady()) {
    return { ok: false, message: "Achats indisponibles sur cette version." };
  }
  const user = getState().user || {};
  if (!user.loggedIn || user.isGuest) {
    return { ok: false, message: "Connecte-toi avec un compte pour acheter Sans pub." };
  }
  try {
    const Purchases = await ensurePurchasesConfigured();
    await Purchases.logIn({ appUserID: getState().supabaseUserId });
    const offerings = unwrapOfferings(await Purchases.getOfferings());
    const pkg = packageForAdFree(offerings);
    if (!pkg) {
      return {
        ok: false,
        message: "Offre Sans pub introuvable. Vérifie le produit Play dans RevenueCat.",
      };
    }
    await Purchases.purchasePackage({ aPackage: pkg });
    const adFree = await refreshAdFreeAfterStore();
    return {
      ok: true,
      adFree,
      message: adFree
        ? "Sans pub est actif sur ce compte."
        : "Achat enregistré. L’activation peut prendre une minute — rouvre Profil si la bannière est encore là.",
    };
  } catch (e) {
    if (isUserCancelled(e)) return { ok: false, cancelled: true };
    return { ok: false, message: e?.message || "Achat impossible." };
  }
}

export async function restoreAdFree() {
  if (!isNativeApp()) {
    return { ok: false, message: "La restauration se fait dans l’app native." };
  }
  if (!isPurchasesNativeReady()) {
    return { ok: false, message: "Achats indisponibles sur cette version." };
  }
  const user = getState().user || {};
  if (!user.loggedIn || user.isGuest) {
    return { ok: false, message: "Connecte-toi avec un compte pour restaurer l’achat." };
  }
  try {
    const Purchases = await ensurePurchasesConfigured();
    await Purchases.logIn({ appUserID: getState().supabaseUserId });
    await Purchases.restorePurchases();
    const adFree = await refreshAdFreeAfterStore();
    return {
      ok: true,
      adFree,
      message: adFree
        ? "Sans pub est de nouveau actif sur ce compte."
        : "Aucun achat Sans pub trouvé pour ce compte.",
    };
  } catch (e) {
    return { ok: false, message: e?.message || "Restauration impossible." };
  }
}
