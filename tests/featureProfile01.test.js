import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";
import {
  isAdFree,
  isProfilePack,
  profilePackFromProfile,
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

describe("FEATURE-PROFILE-01 — entitlement Profil", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("profilePackFromProfile n’accepte que true strict", () => {
    assert.equal(profilePackFromProfile({ profile_pack: true }), true);
    assert.equal(profilePackFromProfile({ profile_pack: false }), false);
    assert.equal(profilePackFromProfile({ profile_pack: "true" }), false);
    assert.equal(profilePackFromProfile({ ad_free: true }), false);
    assert.equal(profilePackFromProfile(null), false);
  });

  it("isProfilePack ignore les invités même si profilePack local est true", () => {
    patchUser({ loggedIn: false, isGuest: true, profilePack: true, adFree: false });
    assert.equal(isProfilePack(), false);
    assert.equal(isAdFree(), false);
  });

  it("isProfilePack true seulement pour un compte connecté", () => {
    patchUser({ loggedIn: true, isGuest: false, profilePack: true, adFree: false });
    assert.equal(isProfilePack(), true);
  });

  it("isAdFree vrai si profile_pack même sans ad_free", () => {
    patchUser({ loggedIn: true, isGuest: false, profilePack: true, adFree: false });
    assert.equal(isAdFree(), true);
  });

  it("isAdFree reste vrai pour Sans pub seul", () => {
    patchUser({ loggedIn: true, isGuest: false, profilePack: false, adFree: true });
    assert.equal(isAdFree(), true);
    assert.equal(isProfilePack(), false);
  });

  it("SQL protège profile_pack côté authenticated", () => {
    const sql = src("supabase/feature-profile-01-profile-flag.sql");
    assert.match(sql, /add column if not exists profile_pack/);
    assert.match(sql, /profiles_protect_profile_pack/);
    assert.match(sql, /authenticated/);
    assert.match(sql, /new\.profile_pack := old\.profile_pack/);
    assert.equal(/ad_free\s*=\s*true/.test(sql), false);
  });

  it("fetchProfile lit profile_pack ; upsert ne l’écrit pas", () => {
    const profile = src("js/core/supabaseProfile.js");
    assert.match(profile, /profile_pack/);
    const upsert = profile.slice(profile.indexOf("export async function upsertProfile"));
    assert.equal(/profile_pack\s*:/.test(upsert), false);
    assert.equal(/ad_free\s*:/.test(upsert), false);
  });
});
