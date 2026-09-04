import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";
import { isAdFree, adFreeFromProfile } from "../js/core/entitlements.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-ADFREE-01 — entitlement Sans pub", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("adFreeFromProfile n’accepte que true strict", () => {
    assert.equal(adFreeFromProfile({ ad_free: true }), true);
    assert.equal(adFreeFromProfile({ ad_free: false }), false);
    assert.equal(adFreeFromProfile({ ad_free: "true" }), false);
    assert.equal(adFreeFromProfile(null), false);
  });

  it("isAdFree ignore les invités même si adFree local est true", () => {
    saveStatePatch({
      user: {
        ...(getState().user || {}),
        loggedIn: false,
        isGuest: true,
        adFree: true,
      },
    });
    assert.equal(isAdFree(), false);
  });

  it("isAdFree true seulement pour un compte connecté", () => {
    saveStatePatch({
      user: {
        ...(getState().user || {}),
        loggedIn: true,
        isGuest: false,
        adFree: true,
      },
    });
    assert.equal(isAdFree(), true);
  });

  it("SQL protège ad_free côté authenticated", () => {
    const sql = src("supabase/feature-adfree-01-profile-flag.sql");
    assert.match(sql, /add column if not exists ad_free/);
    assert.match(sql, /profiles_protect_ad_free/);
    assert.match(sql, /authenticated/);
    assert.match(sql, /new\.ad_free := old\.ad_free/);
  });

  it("fetchProfile lit ad_free ; upsert ne l’écrit pas", () => {
    const profile = src("js/core/supabaseProfile.js");
    assert.match(profile, /ad_free/);
    const upsert = profile.slice(profile.indexOf("export async function upsertProfile"));
    assert.equal(/ad_free\s*:/.test(upsert), false);
  });

  it("ads.js coupe la bannière via isAdFree", () => {
    const ads = src("js/core/ads.js");
    assert.match(ads, /from "\.\/entitlements\.js"/);
    assert.match(ads, /!isAdFree\(\)/);
    assert.match(ads, /refreshAdsForEntitlement/);
  });

  it("Menu Forfaits expose Sans pub", () => {
    const settings = src("js/screens/settings.js");
    const ui = src("js/core/adFreeUi.js");
    assert.match(settings, /adFreeSettingsCardHtml/);
    assert.match(settings, /btn-adfree-buy/);
    assert.match(settings, /btn-premium-restore/);
    assert.equal(/btn-adfree-restore/.test(settings), false);
    assert.equal(/btn-adfree-refresh/.test(settings), false);
    assert.match(ui, /Sans pub/);
    assert.match(ui, /2,99/);
    const persoStart = settings.indexOf("function personnalisationPanelHtml");
    const forfaitsStart = settings.indexOf("function forfaitsPanelHtml");
    const supportStart = settings.indexOf("function supportPanelHtml");
    assert.ok(forfaitsStart > persoStart && forfaitsStart < supportStart);
    assert.equal(settings.slice(persoStart, forfaitsStart).includes("adFreeSettingsCardHtml"), false);
    assert.match(settings.slice(forfaitsStart, supportStart), /adFreeSettingsCardHtml/);
    assert.equal(settings.slice(supportStart).includes("adFreeSettingsCardHtml"), false);
  });

  it("la bannière reste sur les écrans de play", () => {
    const ads = src("js/core/ads.js");
    assert.match(ads, /NO_AD_SCREENS = new Set\(\["welcome", "home", "reset-password"\]\)/);
    assert.equal(ads.includes("GAMEPLAY_SCREENS"), false);
    for (const screen of [
      "hottake",
      "speedvote",
      "drawit",
      "trivia",
      "dilemma",
      "traitre",
      "guesslie",
      "tiernight",
    ]) {
      assert.equal(ads.includes(`"${screen}"`), false);
    }
  });
});
