/**
 * App Tracking Transparency iOS (Guideline 2.1) — après UMP, avant les bannières.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-ATT-01 — demande de suivi iOS", () => {
  it("demande ATT après le consentement UMP, iOS seulement", () => {
    const ads = src("js/core/ads.js");
    assert.match(ads, /async function ensureTrackingAuthorization/);
    assert.match(ads, /getNativePlatform\(\) !== "ios"/);
    assert.match(ads, /trackingAuthorizationStatus/);
    assert.match(ads, /requestTrackingAuthorization/);
    assert.match(ads, /notDetermined/);
    const ready = ads.slice(ads.indexOf("async function ensureAdMobReady"));
    const consentIdx = ready.indexOf("ensureConsent(AdMob");
    const attIdx = ready.indexOf("ensureTrackingAuthorization(AdMob)");
    assert.ok(consentIdx >= 0 && attIdx > consentIdx);
  });

  it("le plist iOS garde NSUserTrackingUsageDescription", () => {
    const patch = src("scripts/patchNative.mjs");
    assert.match(patch, /NSUserTrackingUsageDescription/);
  });
});
