import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unwrapOfferings } from "../js/core/purchases.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-ADFREE-02B — achat + webhook", () => {
  it("identifie le compte Supabase, pas un invité", () => {
    const purchases = src("js/core/purchases.js");
    assert.match(purchases, /logIn\(\{\s*appUserID:/);
    assert.match(purchases, /user\.isGuest/);
    assert.match(purchases, /logOut/);
    const auth = src("js/core/supabaseAuth.js");
    assert.match(auth, /syncPurchasesIdentity/);
  });

  it("webhook service_role, jamais le secret dans le client", () => {
    const fn =
      src("supabase/functions/revenuecat-webhook/index.ts") +
      src("supabase/revenuecat-entitlement-patch.js");
    assert.match(fn, /REVENUECAT_WEBHOOK_AUTH/);
    assert.match(fn, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(fn, /ad_free/);
    assert.match(fn, /reveal_adfree/);
    assert.equal(/\bsk_[A-Za-z0-9]{8,}/.test(fn), false);
    const client = src("js/core/purchases.js") + src("data/revenueCatConfig.js");
    assert.equal(/SERVICE_ROLE/.test(client), false);
    assert.equal(/REVENUECAT_WEBHOOK_AUTH/.test(client), false);
  });

  it("entitlements poll après achat, sans écriture client", () => {
    const ent = src("js/core/entitlements.js");
    assert.match(ent, /refreshAdFreeFromServerUntil/);
    assert.match(src("js/core/purchases.js"), /refreshAdFreeFromServerUntil/);
  });

  it("lit getOfferings racine { current } et forme enveloppée { offerings }", () => {
    const pkg = { product: { identifier: "reveal_adfree" } };
    const current = { availablePackages: [pkg] };

    assert.equal(unwrapOfferings({ current, all: { default: current } }).current, current);
    assert.equal(unwrapOfferings({ offerings: { current, all: {} } }).current, current);
    assert.equal(unwrapOfferings(null), null);

    const purchases = src("js/core/purchases.js");
    assert.match(purchases, /unwrapOfferings\(await Purchases\.getOfferings\(\)\)/);
    assert.equal(/const \{ offerings \} = await Purchases\.getOfferings/.test(purchases), false);
    assert.match(purchases, /packageForSku\(offerings, PLAY_PRODUCT_ID_AD_FREE\)/);
    assert.equal(/packagesFromOfferings\(offerings\)\[0\]/.test(purchases), false);
  });
});
