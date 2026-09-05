/**
 * FEATURE-ADFREE-02B / FEATURE-PROFILE-02B — RevenueCat natif.
 *
 * Le client n’écrit jamais `profiles.ad_free` ni `profiles.profile_pack`.
 * Après achat / restore, on relit le profil (webhook service_role).
 */
import { PACK_HOST_LABEL, PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { isNativeApp, getNativePlatform } from "./platform.js";
import { getState } from "./state.js";
import {
  REVENUECAT_ANDROID_PUBLIC_SDK_KEY,
  REVENUECAT_IOS_PUBLIC_SDK_KEY,
  PLAY_PRODUCT_ID_AD_FREE,
  PLAY_PRODUCT_ID_PROFILE,
  PLAY_PRODUCT_ID_PROFILE_UPGRADE,
  PLAY_PRODUCT_ID_HOST,
  PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE,
  PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE,
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
    code === "PURCHASE_CANCELLED" ||
    code === "PURCHASE_CANCELLED_ERROR"
  );
}

export function isAlreadyOwnedError(err) {
  const code = String(err?.code ?? err?.error?.code ?? err?.errorCode ?? "");
  const readable = String(
    err?.readableErrorCode ?? err?.error?.readableErrorCode ?? ""
  );
  const msg = String(err?.message || err?.error?.message || "");
  return (
    code === "6" ||
    /PRODUCT_ALREADY_PURCHASED/i.test(code) ||
    /PRODUCT_ALREADY_PURCHASED/i.test(readable) ||
    /already (active|purchased|owned)/i.test(msg)
  );
}

export function storePurchaseErrorMessage(err) {
  if (isUserCancelled(err)) return "Achat annulé.";
  if (isAlreadyOwnedError(err)) {
    return "Cet achat est déjà actif sur ce compte Play. Restauration en cours…";
  }
  const msg = String(err?.message || err?.error?.message || "").trim();
  if (/network|offline|internet|unavailable/i.test(msg)) {
    return "Pas de connexion. Vérifie le réseau et réessaie.";
  }
  if (/not available/i.test(msg)) {
    return "Produit indisponible sur cet appareil.";
  }
  if (/store problem|billing/i.test(msg)) {
    return "Le store a un souci. Réessaie dans un moment.";
  }
  if (msg && /[àâäéèêëïîôùûüç]/i.test(msg)) return msg;
  return "Achat impossible. Réessaie, ou appuie sur Restaurer les achats.";
}

export function unwrapCustomerInfo(result) {
  if (!result || typeof result !== "object") return null;
  if (result.entitlements) return result;
  if (result.customerInfo && typeof result.customerInfo === "object") {
    return result.customerInfo;
  }
  return result;
}

export function entitlementsFromCustomerInfo(result) {
  const info = unwrapCustomerInfo(result);
  const active = info?.entitlements?.active;
  if (!active || typeof active !== "object") {
    return { adFree: false, profilePack: false, hostPack: false };
  }
  const hostPack = Boolean(active.host);
  const profilePack = Boolean(active.profile) || hostPack;
  const adFree = Boolean(active.ad_free) || profilePack;
  return { adFree, profilePack, hostPack };
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

function packageForHost(offerings, user) {
  return packageForSku(offerings, hostSkuForUser(user));
}

/** SKU Profil : 4,00 € si Sans pub déjà là, sinon 6,99 €. Pas de fallback sur Sans pub. */
export function profileSkuForUser(user) {
  if (user?.adFree === true && user?.profilePack !== true && user?.hostPack !== true) {
    return PLAY_PRODUCT_ID_PROFILE_UPGRADE;
  }
  return PLAY_PRODUCT_ID_PROFILE;
}

/** SKU Maître : 3 € si Signature, 7 € si Sans pub seul, sinon 9,99 €. */
export function hostSkuForUser(user) {
  if (user?.hostPack === true) return PLAY_PRODUCT_ID_HOST;
  if (user?.profilePack === true) return PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE;
  if (user?.adFree === true) return PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE;
  return PLAY_PRODUCT_ID_HOST;
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

async function refreshHostPackAfterStore() {
  const { refreshHostPackFromServerUntil } = await import("./entitlements.js");
  const on = await refreshHostPackFromServerUntil(true, { tries: 8, delayMs: 1000 });
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
    if (isAlreadyOwnedError(e)) return recoverOwnedPurchase();
    return { ok: false, message: storePurchaseErrorMessage(e) };
  }
}

async function syncStorePurchases(Purchases) {
  if (typeof Purchases?.syncPurchases === "function") {
    try {
      await Purchases.syncPurchases();
    } catch {
      /* iOS ou store déjà à jour */
    }
  }
}

async function recoverOwnedPurchase() {
  const Purchases = await ensurePurchasesConfigured();
  await Purchases.logIn({ appUserID: getState().supabaseUserId });
  await syncStorePurchases(Purchases);
  await Purchases.restorePurchases();
  const fromStore = entitlementsFromCustomerInfo(await Purchases.getCustomerInfo());
  const { applyPremiumFromStore, refreshAdFreeFromServer, isAdFree, isProfilePack, isHostPack } =
    await import("./entitlements.js");
  if (fromStore.adFree || fromStore.profilePack || fromStore.hostPack) {
    applyPremiumFromStore(fromStore);
    await refreshAdFreeFromServer();
    if (!isAdFree() && !isProfilePack() && !isHostPack()) applyPremiumFromStore(fromStore);
    await refreshAdsQuiet();
    const adFree = isAdFree();
    const profilePack = isProfilePack();
    const hostPack = isHostPack();
    let message = "Cet achat est déjà sur ce compte Play. Appuie sur Restaurer les achats si le forfait n’apparaît pas.";
    if (hostPack) {
      message = `${PACK_HOST_LABEL} est déjà actif sur ce compte Play — c’est maintenant affiché. Signature et Sans pub inclus.`;
    } else if (profilePack) {
      message = `${PACK_SIGNATURE_LABEL} est déjà actif sur ce compte Play — c’est maintenant affiché. Sans pub inclus.`;
    } else if (adFree) {
      message = "Sans pub est déjà actif sur ce compte Play — c’est maintenant affiché.";
    }
    return { ok: true, adFree, profilePack, hostPack, alreadyOwned: true, message };
  }
  const refreshed = await refreshPremiumAfterStore();
  let message = "Cet achat est déjà sur ce compte Play. Appuie sur Restaurer les achats si le forfait n’apparaît pas.";
  if (refreshed.hostPack) {
    message = `${PACK_HOST_LABEL} est déjà actif sur ce compte Play — c’est maintenant affiché. Signature et Sans pub inclus.`;
  } else if (refreshed.profilePack) {
    message = `${PACK_SIGNATURE_LABEL} est déjà actif sur ce compte Play — c’est maintenant affiché. Sans pub inclus.`;
  } else if (refreshed.adFree) {
    message = "Sans pub est déjà actif sur ce compte Play — c’est maintenant affiché.";
  }
  return { ok: true, ...refreshed, alreadyOwned: true, message };
}

async function refreshPremiumAfterStore() {
  const { refreshAdFreeFromServer, isAdFree, isProfilePack, isHostPack } = await import(
    "./entitlements.js"
  );
  const tries = 8;
  const delayMs = 1000;
  let adFree = false;
  let profilePack = false;
  let hostPack = false;
  for (let i = 0; i < tries; i++) {
    await refreshAdFreeFromServer();
    adFree = isAdFree();
    profilePack = isProfilePack();
    hostPack = isHostPack();
    if (hostPack) break;
    if (profilePack) break;
    if (adFree && i >= 2) break;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  await refreshAdsQuiet();
  return { adFree, profilePack, hostPack };
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
    await syncStorePurchases(Purchases);
    await Purchases.restorePurchases();
    const fromStore = entitlementsFromCustomerInfo(await Purchases.getCustomerInfo());
    const { applyPremiumFromStore } = await import("./entitlements.js");
    if (fromStore.adFree || fromStore.profilePack || fromStore.hostPack) {
      applyPremiumFromStore(fromStore);
    }
    const refreshed = await refreshPremiumAfterStore();
    let adFree = refreshed.adFree;
    let profilePack = refreshed.profilePack;
    let hostPack = refreshed.hostPack;
    if (
      !adFree &&
      !profilePack &&
      !hostPack &&
      (fromStore.adFree || fromStore.profilePack || fromStore.hostPack)
    ) {
      applyPremiumFromStore(fromStore);
      adFree = fromStore.adFree;
      profilePack = fromStore.profilePack;
      hostPack = fromStore.hostPack;
    }
    let message = "Aucun achat trouvé pour ce compte.";
    if (hostPack) {
      message = `${PACK_HOST_LABEL} est de nouveau actif sur ce compte. Signature et Sans pub inclus.`;
    } else if (profilePack) {
      message = `${PACK_SIGNATURE_LABEL} est de nouveau actif sur ce compte. Sans pub inclus.`;
    } else if (adFree) {
      message = "Sans pub est de nouveau actif sur ce compte.";
    }
    return { ok: true, adFree, profilePack, hostPack, message };
  } catch (e) {
    return { ok: false, message: storePurchaseErrorMessage(e) };
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
  if (user.profilePack === true || user.hostPack === true) {
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
    if (isAlreadyOwnedError(e)) return recoverOwnedPurchase();
    return { ok: false, message: storePurchaseErrorMessage(e) };
  }
}

export async function restoreProfile() {
  return restorePremiumPurchases();
}

export async function purchaseHost() {
  if (!isNativeApp()) {
    return {
      ok: false,
      message: `L’achat ${PACK_HOST_LABEL} se fait dans l’app native, pas sur le web.`,
    };
  }
  if (!isPurchasesNativeReady()) {
    return { ok: false, message: "Achats indisponibles sur cette version." };
  }
  const user = getState().user || {};
  if (!user.loggedIn || user.isGuest) {
    return { ok: false, message: `Connecte-toi avec un compte pour acheter ${PACK_HOST_LABEL}.` };
  }
  if (user.hostPack === true) {
    return { ok: true, hostPack: true, message: `${PACK_HOST_LABEL} est déjà actif sur ce compte.` };
  }
  try {
    const Purchases = await ensurePurchasesConfigured();
    await Purchases.logIn({ appUserID: getState().supabaseUserId });
    const offerings = unwrapOfferings(await Purchases.getOfferings());
    const pkg = packageForHost(offerings, user);
    if (!pkg) {
      return {
        ok: false,
        message: `Offre ${PACK_HOST_LABEL} introuvable. Vérifie le produit dans RevenueCat.`,
      };
    }
    await Purchases.purchasePackage({ aPackage: pkg });
    const hostPack = await refreshHostPackAfterStore();
    return {
      ok: true,
      hostPack,
      message: hostPack
        ? `${PACK_HOST_LABEL} est actif sur ce compte.`
        : "Achat enregistré. L’activation peut prendre une minute — rouvre le menu si ce n’est pas encore affiché.",
    };
  } catch (e) {
    if (isUserCancelled(e)) return { ok: false, cancelled: true };
    if (isAlreadyOwnedError(e)) return recoverOwnedPurchase();
    return { ok: false, message: storePurchaseErrorMessage(e) };
  }
}

export async function restoreHost() {
  return restorePremiumPurchases();
}

