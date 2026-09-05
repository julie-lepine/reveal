import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function optionalSrc(rel) {
  const path = join(ROOT, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

describe("FEATURE-ADFREE-02A — préparation Billing / RevenueCat", () => {
  it("installe @revenuecat/purchases-capacitor", () => {
    const pkg = JSON.parse(src("package.json"));
    assert.ok(pkg.dependencies["@revenuecat/purchases-capacitor"]);
  });

  it("applicationId reste com.reveal.partygames", () => {
    const cap = src("capacitor.config.ts");
    assert.match(cap, /appId:\s*'com\.reveal\.partygames'/);

    const gradle = optionalSrc("android/app/build.gradle");
    if (gradle) {
      assert.match(gradle, /applicationId "com\.reveal\.partygames"/);
      assert.match(gradle, /namespace = "com\.reveal\.partygames"/);
    }

    const patch = src("scripts/patchNative.mjs");
    assert.match(patch, /ANDROID_APPLICATION_ID = "com\.reveal\.partygames"/);
  });

  it("déclare BILLING dans le manifeste app et le persiste via patchNative", () => {
    const patch = src("scripts/patchNative.mjs");
    assert.match(patch, /com\.android\.vending\.BILLING/);

    const manifest = optionalSrc("android/app/src/main/AndroidManifest.xml");
    if (manifest) {
      assert.match(manifest, /android:name="com\.android\.vending\.BILLING"/);
    }
  });

  it("n’expose aucun secret RevenueCat / Supabase", () => {
    const config = src("data/revenueCatConfig.js");
    assert.match(config, /goog_/);
    assert.match(config, /REVENUECAT_IOS_PUBLIC_SDK_KEY/);
    assert.match(config, /appl_bpgdhybGDtsIWmmFNqlRlnJxLgV/);
    assert.equal(/\bsk_[A-Za-z0-9]/.test(config), false);
    assert.equal(/service_role\s*[:=]/.test(config), false);
    assert.equal(/whsec_/.test(config), false);
  });

  it("le socle purchases n’écrit pas ad_free en base", () => {
    const purchases = src("js/core/purchases.js");
    assert.equal(/\.from\(["']profiles["']\)/.test(purchases), false);
    assert.match(purchases, /Purchases\.configure/);
    assert.match(purchases, /logIn/);
    assert.match(purchases, /purchasePackage/);
    assert.match(purchases, /restorePurchases/);

    const main = src("js/main.js");
    assert.equal(/purchases\.js/.test(main), false);
  });

  it("Forfaits : Acheter / Restaurer, pas Actualiser", () => {
    const ui = src("js/core/adFreeUi.js");
    const settings = src("js/screens/settings.js");
    assert.match(ui, /btn-adfree-buy/);
    assert.equal(/btn-adfree-buy" disabled/.test(ui), false);
    assert.match(ui, /Débloquer Sans pub - 2,99&nbsp;€/);
    assert.equal(/id="btn-adfree-restore"/.test(ui), false);
    assert.equal(/btn-adfree-refresh/.test(ui), false);
    assert.match(ui, /2,99/);
    assert.match(src("js/core/premiumOfferUi.js"), /Paiement unique/);
    assert.equal(/Licence testeur|0&nbsp;€/.test(ui), false);
    assert.match(settings, /purchaseAdFree/);
    assert.match(settings, /restorePremiumPurchases/);
    assert.match(settings, /btn-premium-restore/);
  });
});
