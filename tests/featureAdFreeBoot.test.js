/**
 * Boot natif : relire CustomerInfo après logIn, sans restore ni écriture SQL.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let native = true;

const logIn = mock.fn(async () => loginOk());
const logOut = mock.fn(async () => ({ customerInfo: emptyCustomer() }));
const getCustomerInfo = mock.fn(async () => ({ customerInfo: emptyCustomer() }));
const restorePurchases = mock.fn(async () => ({ customerInfo: emptyCustomer() }));
const refreshAdsForEntitlement = mock.fn();

const purchases = {
  configure: async () => {},
  addCustomerInfoUpdateListener() {},
  logIn,
  logOut,
  getCustomerInfo,
  restorePurchases,
};

function emptyCustomer() {
  return { entitlements: { active: {} } };
}

function loginOk(customerInfo = emptyCustomer()) {
  return { customerInfo, created: false };
}

function customerResult(active) {
  return { customerInfo: { entitlements: { active } } };
}

function defer() {
  /** @type {(value: unknown) => void} */
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

mock.module("../js/core/platform.js", {
  namedExports: {
    isNativeApp: () => native,
    getNativePlatform: () => (native ? "android" : "web"),
  },
});

mock.module("../js/core/capacitorImports.js", {
  namedExports: {
    loadRevenueCatPurchases: async () => ({ Purchases: purchases }),
  },
});

mock.module("../data/revenueCatConfig.js", {
  namedExports: {
    REVENUECAT_ANDROID_PUBLIC_SDK_KEY: "goog_test_sdk_key",
    REVENUECAT_IOS_PUBLIC_SDK_KEY: "appl_test_sdk_key",
    PLAY_PRODUCT_ID_AD_FREE: "reveal_adfree",
    PLAY_PRODUCT_ID_PROFILE: "reveal_profile",
    PLAY_PRODUCT_ID_PROFILE_UPGRADE: "reveal_profile_upgrade",
    PLAY_PRODUCT_ID_HOST: "reveal_host",
    PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE: "reveal_host_from_adfree",
    PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE: "reveal_host_from_profile",
  },
});

mock.module("../js/core/ads.js", {
  namedExports: {
    refreshAdsForEntitlement,
  },
});

const { getState, saveStatePatch } = await import("../js/core/state.js");
const {
  isAdFree,
  isProfilePack,
  isHostPack,
  getStorePremiumOverlay,
  resetPremiumStoreOverlayForTests,
  applyPremiumFromStore,
} = await import("../js/core/entitlements.js");
const { syncPurchasesIdentity } = await import("../js/core/purchases.js");

function setAccount(id, fields = {}) {
  saveStatePatch({
    supabaseUserId: id,
    user: {
      ...(getState().user || {}),
      loggedIn: true,
      isGuest: false,
      adFree: false,
      profilePack: false,
      hostPack: false,
      ...fields,
    },
  });
}

describe("Sans pub — relecture CustomerInfo au boot natif", () => {
  /** @type {ReturnType<typeof structuredClone>} */
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    native = true;
    resetPremiumStoreOverlayForTests();
    logIn.mock.resetCalls();
    logOut.mock.resetCalls();
    getCustomerInfo.mock.resetCalls();
    restorePurchases.mock.resetCalls();
    refreshAdsForEntitlement.mock.resetCalls();
    logIn.mock.mockImplementation(async () => loginOk());
    logOut.mock.mockImplementation(async () => ({ customerInfo: emptyCustomer() }));
    getCustomerInfo.mock.mockImplementation(async () => ({ customerInfo: emptyCustomer() }));
    restorePurchases.mock.mockImplementation(async () => ({ customerInfo: emptyCustomer() }));
    setAccount("user-a");
  });

  afterEach(() => {
    resetPremiumStoreOverlayForTests();
    saveStatePatch(snapshot);
  });

  it("1. ad_free actif et serveur faux : l’overlay masque les pubs", async () => {
    getCustomerInfo.mock.mockImplementation(async () =>
      customerResult({ ad_free: { identifier: "ad_free" } })
    );
    await syncPurchasesIdentity();
    assert.equal(isAdFree(), true);
    assert.equal(isProfilePack(), false);
    assert.equal(isHostPack(), false);
    assert.equal(getStorePremiumOverlay()?.adFree, true);
    assert.equal(refreshAdsForEntitlement.mock.callCount() > 0, true);
    assert.equal(restorePurchases.mock.callCount(), 0);
  });

  it("2. profile actif implique Sans pub, host aussi", async () => {
    getCustomerInfo.mock.mockImplementation(async () =>
      customerResult({ profile: { identifier: "profile" } })
    );
    await syncPurchasesIdentity();
    assert.equal(isProfilePack(), true);
    assert.equal(isAdFree(), true);
    assert.equal(isHostPack(), false);

    resetPremiumStoreOverlayForTests();
    setAccount("user-a");
    getCustomerInfo.mock.mockImplementation(async () =>
      customerResult({ host: { identifier: "host" } })
    );
    await syncPurchasesIdentity();
    assert.equal(isHostPack(), true);
    assert.equal(isProfilePack(), true);
    assert.equal(isAdFree(), true);
  });

  it("3. aucun entitlement actif n’écrase un overlay déjà posé", async () => {
    applyPremiumFromStore({ adFree: true });
    assert.equal(isAdFree(), true);
    await syncPurchasesIdentity();
    assert.equal(isAdFree(), true);
    assert.equal(getStorePremiumOverlay()?.adFree, true);
  });

  it("4. getCustomerInfo rejeté : pas d’exception, pas d’overlay", async () => {
    getCustomerInfo.mock.mockImplementation(async () => {
      throw new Error("rc down");
    });
    await syncPurchasesIdentity();
    assert.equal(isAdFree(), false);
    assert.equal(getStorePremiumOverlay(), null);
  });

  it("logIn sans customerInfo n’est pas une identification et ne lit pas CustomerInfo", async () => {
    logIn.mock.mockImplementation(async () => ({ created: false }));
    await syncPurchasesIdentity();
    assert.equal(getCustomerInfo.mock.callCount(), 0);
    assert.equal(isAdFree(), false);
  });

  it("5. logout pendant la lecture : la réponse tardive ne réactive pas l’overlay", async () => {
    const gate = defer();
    getCustomerInfo.mock.mockImplementation(() => gate.promise);
    const pending = syncPurchasesIdentity();
    await settle();
    assert.equal(getCustomerInfo.mock.callCount(), 1);
    saveStatePatch({
      supabaseUserId: null,
      user: {
        ...(getState().user || {}),
        loggedIn: false,
        isGuest: false,
        adFree: false,
        profilePack: false,
        hostPack: false,
      },
    });
    gate.resolve(customerResult({ ad_free: { identifier: "ad_free" } }));
    await pending;
    assert.equal(isAdFree(), false);
    assert.equal(getStorePremiumOverlay(), null);
  });

  it("6. passage de A à B pendant la lecture : l’entitlement de A ne s’applique pas à B", async () => {
    const gate = defer();
    setAccount("user-a");
    getCustomerInfo.mock.mockImplementation(() => gate.promise);
    const pending = syncPurchasesIdentity();
    await settle();
    setAccount("user-b");
    gate.resolve(customerResult({ ad_free: { identifier: "ad_free" } }));
    await pending;
    assert.equal(getState().supabaseUserId, "user-b");
    assert.equal(isAdFree(), false);
    assert.equal(getStorePremiumOverlay(), null);
  });

  it("7. appel obsolète concurrent : seule la lecture du compte courant peut poser l’overlay", async () => {
    const gateA = defer();
    setAccount("user-a");
    getCustomerInfo.mock.mockImplementation(() => gateA.promise);
    const pendingA = syncPurchasesIdentity();
    await settle();
    assert.equal(getCustomerInfo.mock.callCount(), 1);

    const gateB = defer();
    setAccount("user-b");
    getCustomerInfo.mock.mockImplementation(() => gateB.promise);
    const pendingB = syncPurchasesIdentity();
    await settle();

    gateA.resolve(customerResult({ ad_free: { identifier: "ad_free" } }));
    await pendingA;
    assert.equal(isAdFree(), false);
    assert.equal(isHostPack(), false);

    gateB.resolve(customerResult({ host: { identifier: "host" } }));
    await pendingB;
    assert.equal(getState().supabaseUserId, "user-b");
    assert.equal(isHostPack(), true);
    assert.equal(isAdFree(), true);
  });

  it("8. invité : logOut, aucune lecture CustomerInfo", async () => {
    saveStatePatch({
      supabaseUserId: "guest-1",
      user: {
        ...(getState().user || {}),
        loggedIn: false,
        isGuest: true,
        adFree: true,
        profilePack: false,
        hostPack: false,
      },
    });
    await syncPurchasesIdentity();
    assert.equal(logOut.mock.callCount(), 1);
    assert.equal(logIn.mock.callCount(), 0);
    assert.equal(getCustomerInfo.mock.callCount(), 0);
    assert.equal(isAdFree(), false);
  });

  it("9. web : aucune lecture native", async () => {
    native = false;
    await syncPurchasesIdentity();
    assert.equal(logIn.mock.callCount(), 0);
    assert.equal(logOut.mock.callCount(), 0);
    assert.equal(getCustomerInfo.mock.callCount(), 0);
    assert.equal(restorePurchases.mock.callCount(), 0);
  });

  it("10. profil déjà actif et store vide : le flag serveur local reste", async () => {
    setAccount("user-a", { adFree: true });
    await syncPurchasesIdentity();
    assert.equal(isAdFree(), true);
    assert.equal(getStorePremiumOverlay(), null);
  });

  it("11. le boot n’appelle pas restorePurchases ; le flux manuel le conserve", async () => {
    await syncPurchasesIdentity();
    assert.equal(restorePurchases.mock.callCount(), 0);
    const src = readFileSync(join(ROOT, "js/core/purchases.js"), "utf8");
    const restoreFn = src.slice(src.indexOf("export async function restorePremiumPurchases"));
    assert.match(restoreFn, /Purchases\.restorePurchases\(\)/);
    assert.equal(restoreFn.includes("syncPurchasesIdentity"), false);
  });
});
