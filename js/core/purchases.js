/**
 * FEATURE-ADFREE-02B / FEATURE-PROFILE-02B — RevenueCat natif.
 *
 * Le client n’écrit jamais `profiles.ad_free` ni `profiles.profile_pack`.
 * Après achat / restore, on relit le profil (webhook service_role).
 */
import { PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { isNativeApp, getNativePlatform } from "./platform.js";
import { getState } from "./state.js";
import {
  REVENUECAT_ANDROID_PUBLIC_SDK_KEY,
  REVENUECAT_IOS_PUBLIC_SDK_KEY,
  PLAY_PRODUCT_ID_AD_FREE,
  PLAY_PRODUCT_ID_PROFILE,
  PLAY_PRODUCT_ID_PROFILE_UPGRADE,
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

function productIdentifier(pkg) {
  return String(pkg?.product?.identifier || pkg?.product?.productIdentifier || "");
}

function identifierMatchesSku(id, sku) {
  if (!id || !sku) return false;
  return id === sku || id.endsWith(`.${sku}`);
}

function packagesFromOfferings(offerings) {
  const current = offerings?.current;
  return (
    current?.availablePackages ||
    offerings?.all?.default?.availablePackages ||
    []
  );
}

function packageForSku(offerings, sku) {
  const packages = packagesFromOfferings(offerings);
  return packages.find((pkg) => identifierMatchesSku(productIdentifier(pkg), sku)) || null;
}

function packageForAdFree(offerings) {
  const match = packageForSku(offerings, PLAY_PRODUCT_ID_AD_FREE);
  if (match) return match;
  const current = offerings?.current;
  return current?.lifetime || offerings?.all?.default?.lifetime || null;
}

/** SKU Profil : 4,00 € si Sans pub déjà là, sinon 6,99 €. Pas de fallback sur Sans pub. */
export function profileSkuForUser(user) {
  if (user?.adFree === true && user?.profilePack !== true) {
    return PLAY_PRODUCT_ID_PROFILE_UPGRADE;
  }
  return PLAY_PRODUCT_ID_PROFILE;
}

function packageForProfile(offerings, user) {
  return packageForSku(offerings, profileSkuForUser(user));
}

async function refreshAdFreeAfterStore() {
  const { refreshAdFreeFromServerUntil } = await import("./entitlements.js");
  const on = await refreshAdFreeFromServerUntil(true, { tries: 8, delayMs: 1000 });
  await refreshAdsQuiet();
  return on;
}

async function refreshProfilePackAfterStore() {
  const { refreshProfilePackFromServerUntil } = await import("./entitlements.js");
  const on = await refreshProfilePackFromServerUntil(true, { tries: 8, delayMs: 1000 });
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

async function refreshPremiumAfterStore() {
  const { refreshAdFreeFromServer, isAdFree, isProfilePack } = await import("./entitlements.js");
  const tries = 8;
  const delayMs = 1000;
  let adFree = false;
  let profilePack = false;
  for (let i = 0; i < tries; i++) {
    await refreshAdFreeFromServer();
    adFree = isAdFree();
    profilePack = isProfilePack();
    if (profilePack) break;
    if (adFree && i >= 2) break;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  await refreshAdsQuiet();
  return { adFree, profilePack };
}

export async function restorePremiumPurchases() {
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
    const { adFree, profilePack } = await refreshPremiumAfterStore();
    let message = "Aucun achat trouvé pour ce compte.";
    if (profilePack) {
      message = `${PACK_SIGNATURE_LABEL} est de nouveau actif sur ce compte. Sans pub inclus.`;
    } else if (adFree) {
      message = "Sans pub est de nouveau actif sur ce compte.";
    }
    return { ok: true, adFree, profilePack, message };
  } catch (e) {
    return { ok: false, message: e?.message || "Restauration impossible." };
  }
}

export async function restoreAdFree() {
  return restorePremiumPurchases();
}

export async function purchaseProfile() {
  if (!isNativeApp()) {
    return {
      ok: false,
      message: `L’achat ${PACK_SIGNATURE_LABEL} se fait dans l’app native, pas sur le web.`,
    };
  }
  if (!isPurchasesNativeReady()) {
    return { ok: false, message: "Achats indisponibles sur cette version." };
  }
  const user = getState().user || {};
  if (!user.loggedIn || user.isGuest) {
    return { ok: false, message: `Connecte-toi avec un compte pour acheter ${PACK_SIGNATURE_LABEL}.` };
  }
  if (user.profilePack === true) {
    return { ok: true, profilePack: true, message: `${PACK_SIGNATURE_LABEL} est déjà actif sur ce compte.` };
  }
  try {
    const Purchases = await ensurePurchasesConfigured();
    await Purchases.logIn({ appUserID: getState().supabaseUserId });
    const offerings = unwrapOfferings(await Purchases.getOfferings());
    const pkg = packageForProfile(offerings, user);
    if (!pkg) {
      return {
        ok: false,
        message: `Offre ${PACK_SIGNATURE_LABEL} introuvable. Vérifie le produit dans RevenueCat.`,
      };
    }
    await Purchases.purchasePackage({ aPackage: pkg });
    const profilePack = await refreshProfilePackAfterStore();
    return {
      ok: true,
      profilePack,
      message: profilePack
        ? `${PACK_SIGNATURE_LABEL} est actif sur ce compte.`
        : "Achat enregistré. L’activation peut prendre une minute — rouvre le menu si ce n’est pas encore affiché.",
    };
  } catch (e) {
    if (isUserCancelled(e)) return { ok: false, cancelled: true };
    return { ok: false, message: e?.message || "Achat impossible." };
  }
}

export async function restoreProfile() {
  return restorePremiumPurchases();
}
