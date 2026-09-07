/**
 * RC-SKU-ADF — helper pur Sans pub + hydrate login alignée sur le refresh.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";
import {
  isAdFree,
  isAdFreeForUser,
  isHostPack,
  isProfilePack,
  premiumFlagsFromProfile,
} from "../js/core/entitlements.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("RC-SKU-ADF — flags profil + isAdFreeForUser", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("premiumFlagsFromProfile : Signature sans ad_free → profilePack + adFree effectif", () => {
    assert.deepEqual(
      premiumFlagsFromProfile({
        ad_free: false,
        profile_pack: true,
        host_pack: false,
      }),
      { adFree: true, profilePack: true, hostPack: false }
    );
  });

  it("premiumFlagsFromProfile : Sans pub seul", () => {
    assert.deepEqual(
      premiumFlagsFromProfile({
        ad_free: true,
        profile_pack: false,
        host_pack: false,
      }),
      { adFree: true, profilePack: false, hostPack: false }
    );
  });

  it("premiumFlagsFromProfile : Maître seul inclut Signature + Sans pub", () => {
    assert.deepEqual(
      premiumFlagsFromProfile({
        ad_free: false,
        profile_pack: false,
        host_pack: true,
      }),
      { adFree: true, profilePack: true, hostPack: true }
    );
  });

  it("premiumFlagsFromProfile : rien", () => {
    assert.deepEqual(premiumFlagsFromProfile({}), {
      adFree: false,
      profilePack: false,
      hostPack: false,
    });
  });

  it("isAdFreeForUser est pur (OR des trois flags, sans getState)", () => {
    assert.equal(isAdFreeForUser(undefined), false);
    assert.equal(isAdFreeForUser({}), false);
    assert.equal(isAdFreeForUser({ adFree: true }), true);
    assert.equal(isAdFreeForUser({ profilePack: true }), true);
    assert.equal(isAdFreeForUser({ hostPack: true }), true);
    assert.equal(isAdFreeForUser({ adFree: false, profilePack: true }), true);
  });

  it("isAdFreeForUser ignore le user du state global", () => {
    saveStatePatch({
      user: {
        ...(getState().user || {}),
        loggedIn: true,
        isGuest: false,
        adFree: true,
        profilePack: false,
        hostPack: false,
      },
    });
    assert.equal(isAdFreeForUser({ adFree: false, profilePack: false, hostPack: false }), false);
    assert.equal(isAdFree(), true);
  });

  it("isAdFree conserve le filtre invité", () => {
    saveStatePatch({
      user: {
        ...(getState().user || {}),
        loggedIn: false,
        isGuest: true,
        adFree: true,
        profilePack: true,
        hostPack: true,
      },
    });
    assert.equal(isAdFreeForUser(getState().user), true);
    assert.equal(isAdFree(), false);
    assert.equal(isProfilePack(), false);
    assert.equal(isHostPack(), false);
  });

  it("hydrate login et refresh partagent premiumFlagsFromProfile", () => {
    const auth = src("js/core/supabaseAuth.js");
    const ent = src("js/core/entitlements.js");
    assert.match(auth, /premiumFlagsFromProfile\(profile\)/);
    assert.match(ent, /lastServerPremium = premiumFlagsFromProfile\(profile\)/);
    assert.equal(/adFreeFromProfile\(profile\)/.test(auth), false);
    const upsert = src("js/core/supabaseProfile.js");
    const upsertFn = upsert.slice(upsert.indexOf("export async function upsertProfile"));
    assert.equal(/ad_free\s*:/.test(upsertFn), false);
    assert.equal(/host_pack\s*:/.test(upsertFn), false);
  });
});
