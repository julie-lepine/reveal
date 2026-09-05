import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";
import {
  isAdFree,
  isHostPack,
  isProfilePack,
  hostPackFromProfile,
} from "../js/core/entitlements.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function patchUser(partial) {
  saveStatePatch({
    user: {
      ...(getState().user || {}),
      ...partial,
    },
  });
}

describe("FEATURE-HOST-01 — entitlement Maître de soirée", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("hostPackFromProfile n’accepte que true strict", () => {
    assert.equal(hostPackFromProfile({ host_pack: true }), true);
    assert.equal(hostPackFromProfile({ host_pack: false }), false);
    assert.equal(hostPackFromProfile({ host_pack: "true" }), false);
    assert.equal(hostPackFromProfile({ profile_pack: true }), false);
    assert.equal(hostPackFromProfile(null), false);
  });

  it("isHostPack ignore les invités", () => {
    patchUser({ loggedIn: false, isGuest: true, hostPack: true, profilePack: true, adFree: true });
    assert.equal(isHostPack(), false);
    assert.equal(isProfilePack(), false);
    assert.equal(isAdFree(), false);
  });

  it("Maître inclut Signature et Sans pub", () => {
    patchUser({ loggedIn: true, isGuest: false, hostPack: true, profilePack: false, adFree: false });
    assert.equal(isHostPack(), true);
    assert.equal(isProfilePack(), true);
    assert.equal(isAdFree(), true);
  });

  it("SQL protège host_pack côté authenticated", () => {
    const sql = src("supabase/feature-host-01-profile-flag.sql");
    assert.match(sql, /add column if not exists host_pack/);
    assert.match(sql, /profiles_protect_host_pack/);
    assert.match(sql, /authenticated/);
    assert.match(sql, /new\.host_pack := old\.host_pack/);
    assert.equal(/ad_free\s*=\s*true/.test(sql), false);
    assert.equal(/profile_pack\s*=\s*true/.test(sql), false);
  });

  it("fetchProfile lit host_pack ; upsert ne l’écrit pas", () => {
    const profile = src("js/core/supabaseProfile.js");
    assert.match(profile, /host_pack/);
    const upsert = profile.slice(profile.indexOf("export async function upsertProfile"));
    assert.equal(/host_pack\s*:/.test(upsert), false);
    assert.equal(/profile_pack\s*:/.test(upsert), false);
    assert.equal(/ad_free\s*:/.test(upsert), false);
  });
});
