/**
 * RC-RESTORE — overlay Maître si Signature déjà en base, webhook host_pack en retard.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";
import {
  mergePremiumSessionFlags,
  shouldContinuePremiumStorePoll,
  PREMIUM_STORE_POLL_TRIES,
  PREMIUM_STORE_POLL_DELAY_MS,
  hostPackPendingActivationMessage,
  premiumRestoreUserMessage,
} from "../js/core/premiumStoreOverlay.js";
import { resolveLobbySeatCap, MAX_PLAYERS, MAX_PLAYERS_HOST } from "../js/config/lobbyLifecycle.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let profileRow = {
  ad_free: true,
  profile_pack: true,
  host_pack: false,
};
let fetchCount = 0;
let hostPackFromFetch = 0;

mock.module("../js/core/supabaseProfile.js", {
  namedExports: {
    fetchProfile: async () => {
      fetchCount += 1;
      const host =
        hostPackFromFetch > 0 && fetchCount >= hostPackFromFetch
          ? true
          : Boolean(profileRow.host_pack);
      return { ...profileRow, host_pack: host };
    },
  },
});

const {
  applyPremiumFromStore,
  refreshAdFreeFromServer,
  isHostPack,
  isProfilePack,
  isAdFree,
  getLastServerPremium,
  getStorePremiumOverlay,
  resetPremiumStoreOverlayForTests,
} = await import("../js/core/entitlements.js");
const { refreshPremiumAfterStore, reconcilePremiumAfterStore } = await import(
  "../js/core/purchases.js"
);

function loggedInUser(partial = {}) {
  saveStatePatch({
    supabaseUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    user: {
      ...(getState().user || {}),
      loggedIn: true,
      isGuest: false,
      adFree: true,
      profilePack: true,
      hostPack: false,
      ...partial,
    },
  });
}

describe("RC-RESTORE — helpers purs", () => {
  it("11. Signature seule ne donne pas Maître (merge)", () => {
    const merged = mergePremiumSessionFlags(
      { adFree: true, profilePack: true, hostPack: false },
      { adFree: false, profilePack: false, hostPack: false }
    );
    assert.equal(merged.profilePack, true);
    assert.equal(merged.hostPack, false);
  });

  it("12. RevenueCat profile sans host → pas d’overlay Maître", () => {
    const merged = mergePremiumSessionFlags(
      { adFree: true, profilePack: true, hostPack: false },
      { adFree: true, profilePack: true, hostPack: false }
    );
    assert.equal(merged.hostPack, false);
    assert.equal(merged.profilePack, true);
  });

  it("13. host_pack serveur true n’est pas retiré par overlay sans host", () => {
    const merged = mergePremiumSessionFlags(
      { adFree: true, profilePack: true, hostPack: true },
      { adFree: false, profilePack: false, hostPack: false }
    );
    assert.equal(merged.hostPack, true);
  });

  it("2. poll continue si store host et serveur sans host_pack, même avec Signature", () => {
    assert.equal(
      shouldContinuePremiumStorePoll({
        fromStore: { hostPack: true, profilePack: true },
        server: { hostPack: false, profilePack: true, adFree: true },
        attemptIndex: 0,
      }),
      true
    );
  });

  it("poll s’arrête quand le serveur confirme host_pack", () => {
    assert.equal(
      shouldContinuePremiumStorePoll({
        fromStore: { hostPack: true },
        server: { hostPack: true, profilePack: true },
        attemptIndex: 1,
      }),
      false
    );
  });

  it("sans entitlement host, Signature serveur arrête encore le poll (Sans pub inchangé)", () => {
    assert.equal(
      shouldContinuePremiumStorePoll({
        fromStore: { adFree: true },
        server: { hostPack: false, profilePack: true, adFree: true },
        attemptIndex: 0,
      }),
      false
    );
  });

  it("timeout 8×1s documenté", () => {
    assert.equal(PREMIUM_STORE_POLL_TRIES, 8);
    assert.equal(PREMIUM_STORE_POLL_DELAY_MS, 1000);
  });

  it("14. cap 14 seulement si hôte du salon + pack, pas un viewer Maître", () => {
    assert.equal(
      resolveLobbySeatCap({ salonHostPack: false, localIsHost: false, localHostPack: true }),
      MAX_PLAYERS
    );
    assert.equal(
      resolveLobbySeatCap({ salonHostPack: false, localIsHost: true, localHostPack: true }),
      MAX_PLAYERS_HOST
    );
  });
});

describe("RC-RESTORE — overlay / fetchProfile", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    resetPremiumStoreOverlayForTests();
    fetchCount = 0;
    hostPackFromFetch = 0;
    profileRow = { ad_free: true, profile_pack: true, host_pack: false };
    loggedInUser();
  });

  afterEach(() => {
    resetPremiumStoreOverlayForTests();
    saveStatePatch(snapshot);
  });

  it("1. profilePack serveur + RC host → overlay Maître", () => {
    applyPremiumFromStore({ adFree: true, profilePack: true, hostPack: true });
    assert.equal(isHostPack(), true);
    assert.equal(isProfilePack(), true);
    assert.equal(getStorePremiumOverlay()?.hostPack, true);
  });

  it("5. RC host=false → pas d’overlay Maître", () => {
    applyPremiumFromStore({ adFree: true, profilePack: true, hostPack: false });
    assert.equal(isHostPack(), false);
    assert.equal(isProfilePack(), true);
  });

  it("9. fetchProfile host_pack false + overlay host → Maître reste visible", async () => {
    applyPremiumFromStore({ adFree: true, profilePack: true, hostPack: true });
    await refreshAdFreeFromServer();
    assert.equal(getLastServerPremium().hostPack, false);
    assert.equal(getLastServerPremium().profilePack, true);
    assert.equal(isHostPack(), true);
  });

  it("10. fetchProfile host_pack true → serveur confirmé", async () => {
    applyPremiumFromStore({ adFree: true, profilePack: true, hostPack: true });
    profileRow = { ad_free: true, profile_pack: true, host_pack: true };
    await refreshAdFreeFromServer();
    assert.equal(getLastServerPremium().hostPack, true);
    assert.equal(isHostPack(), true);
  });

  it("15. applyPremiumFromStore n’écrit pas host_pack SQL", () => {
    const ent = read("js/core/entitlements.js");
    const apply = ent.slice(ent.indexOf("export function applyPremiumFromStore"));
    assert.doesNotMatch(apply, /host_pack/);
    const upsert = read("js/core/supabaseProfile.js");
    const fn = upsert.slice(upsert.indexOf("export async function upsertProfile"));
    assert.doesNotMatch(fn, /host_pack\s*:/);
  });
});

describe("RC-RESTORE — poll restore / already-owned", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    resetPremiumStoreOverlayForTests();
    fetchCount = 0;
    hostPackFromFetch = 0;
    profileRow = { ad_free: true, profile_pack: true, host_pack: false };
    loggedInUser();
  });

  afterEach(() => {
    resetPremiumStoreOverlayForTests();
    saveStatePatch(snapshot);
  });

  const storeHost = { adFree: true, profilePack: true, hostPack: true };

  it("2+4. poll continue malgré Signature ; timeout conserve overlay + message différé", async () => {
    const res = await refreshPremiumAfterStore(storeHost, { tries: 3, delayMs: 0 });
    assert.equal(fetchCount, 3);
    assert.equal(res.hostPack, true);
    assert.equal(res.serverHostPack, false);
    assert.equal(res.pendingServerHost, true);
    assert.equal(isHostPack(), true);
    const msg = premiumRestoreUserMessage({
      hostPack: true,
      pendingServerHost: true,
    });
    assert.equal(msg, hostPackPendingActivationMessage());
    assert.match(msg, /jusqu’à une minute/);
  });

  it("3. webhook host avant timeout → poll s’arrête, serveur confirmé", async () => {
    hostPackFromFetch = 2;
    const res = await refreshPremiumAfterStore(storeHost, { tries: 5, delayMs: 0 });
    assert.equal(res.serverHostPack, true);
    assert.equal(res.pendingServerHost, false);
    assert.equal(res.hostPack, true);
    assert.equal(fetchCount, 2);
  });

  it("Race 1 : overlay → fetch false → fetch true, Maître toujours actif", async () => {
    applyPremiumFromStore(storeHost);
    assert.equal(isHostPack(), true);
    await refreshAdFreeFromServer();
    assert.equal(isHostPack(), true);
    profileRow = { ad_free: true, profile_pack: true, host_pack: true };
    await refreshAdFreeFromServer();
    assert.equal(isHostPack(), true);
    assert.equal(getLastServerPremium().hostPack, true);
  });

  it("6–8. already-owned : même reconcile, overlay conservé si webhook absent", async () => {
    const res = await reconcilePremiumAfterStore(storeHost, {
      alreadyOwned: true,
      tries: 2,
      delayMs: 0,
    });
    assert.equal(res.ok, true);
    assert.equal(res.alreadyOwned, true);
    assert.equal(res.hostPack, true);
    assert.equal(res.pendingServerHost, true);
    assert.match(res.message, /confirmé par votre achat/);
  });

  it("already-owned + webhook arrivé", async () => {
    profileRow = { ad_free: true, profile_pack: true, host_pack: true };
    const res = await reconcilePremiumAfterStore(storeHost, {
      alreadyOwned: true,
      tries: 2,
      delayMs: 0,
    });
    assert.equal(res.pendingServerHost, false);
    assert.equal(res.serverHostPack, true);
    assert.match(res.message, /déjà actif/);
  });

  it("restore sans already-owned + timeout : message activation différée", async () => {
    const res = await reconcilePremiumAfterStore(storeHost, {
      alreadyOwned: false,
      tries: 2,
      delayMs: 0,
    });
    assert.equal(res.pendingServerHost, true);
    assert.equal(res.message, hostPackPendingActivationMessage());
  });
});

describe("RC-RESTORE — contrats source", () => {
  it("restore et already-owned passent par le même reconcile", () => {
    const src = read("js/core/purchases.js");
    const recover = src.slice(
      src.indexOf("async function recoverOwnedPurchase"),
      src.indexOf("export async function refreshPremiumAfterStore")
    );
    const restore = src.slice(
      src.indexOf("export async function restorePremiumPurchases"),
      src.indexOf("export async function restoreAdFree")
    );
    assert.match(recover, /reconcilePremiumAfterStore/);
    assert.match(restore, /reconcilePremiumAfterStore/);
    assert.match(src, /shouldContinuePremiumStorePoll/);
    assert.match(src, /poll timeout — retaining store overlay/);
    assert.match(src, /server host_pack pending/);
  });

  it("refreshPremiumAfterStore n’écrit pas host_pack", () => {
    const src = read("js/core/purchases.js");
    const fn = src.slice(src.indexOf("export async function refreshPremiumAfterStore"));
    assert.doesNotMatch(fn.slice(0, 1800), /host_pack\s*:/);
  });

  it("profileSkuForUser reste pur (RC-SKU-ADF)", () => {
    const src = read("js/core/purchases.js");
    const start = src.indexOf("export function profileSkuForUser");
    const end = src.indexOf("export function hostSkuForUser");
    const fn = src.slice(start, end);
    assert.match(fn, /isAdFreeForUser\(user\)/);
    assert.equal(/getState\(/.test(fn), false);
    assert.equal(/isAdFree\(\)/.test(fn), false);
  });
});
