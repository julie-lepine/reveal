import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  entitlementPatch,
  eventTouchesProfile,
} from "../supabase/revenuecat-entitlement-patch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-PROFILE-02B — webhook + poll", () => {
  it("GRANT Profil pose profile_pack + ad_free", () => {
    assert.deepEqual(
      entitlementPatch("INITIAL_PURCHASE", { product_id: "reveal_profile" }),
      { profile_pack: true, ad_free: true }
    );
    assert.deepEqual(
      entitlementPatch("NON_RENEWING_PURCHASE", { product_id: "reveal_profile_upgrade" }),
      { profile_pack: true, ad_free: true }
    );
    assert.equal(eventTouchesProfile({ entitlement_ids: ["profile"] }), true);
  });

  it("REFUND upgrade retire Profil et garde Sans pub", () => {
    assert.deepEqual(
      entitlementPatch("REFUND", { product_id: "reveal_profile_upgrade" }),
      { profile_pack: false }
    );
  });

  it("REFUND 6,99 retire Profil et Sans pub", () => {
    assert.deepEqual(
      entitlementPatch("REFUND", { product_id: "reveal_profile" }),
      { profile_pack: false, ad_free: false }
    );
  });

  it("RESTORE pose les mêmes flags qu’un achat", () => {
    assert.deepEqual(entitlementPatch("RESTORE", { product_id: "reveal_adfree" }), {
      ad_free: true,
    });
    assert.deepEqual(entitlementPatch("RESTORE", { product_id: "reveal_profile" }), {
      profile_pack: true,
      ad_free: true,
    });
    assert.match(src("supabase/functions/revenuecat-webhook/index.ts"), /"RESTORE"/);
  });

  it("GRANT/REVOKE Sans pub seul ne touche pas profile_pack", () => {
    assert.deepEqual(entitlementPatch("INITIAL_PURCHASE", { product_id: "reveal_adfree" }), {
      ad_free: true,
    });
    assert.deepEqual(entitlementPatch("REFUND", { product_id: "reveal_adfree" }), {
      ad_free: false,
    });
  });

  it("webhook service_role, poll après achat, zéro écriture client", () => {
    const fn =
      src("supabase/functions/revenuecat-webhook/index.ts") +
      src("supabase/revenuecat-entitlement-patch.js");
    assert.match(fn, /REVENUECAT_WEBHOOK_AUTH/);
    assert.match(fn, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(fn, /profile_pack/);
    assert.match(fn, /reveal_profile/);
    const purchases = src("js/core/purchases.js");
    assert.equal(/\.from\(["']profiles["']\)/.test(purchases), false);
    assert.match(purchases, /refreshProfilePackFromServerUntil/);
    const client = purchases + src("data/revenueCatConfig.js");
    assert.equal(/SERVICE_ROLE/.test(client), false);
    assert.equal(/REVENUECAT_WEBHOOK_AUTH/.test(client), false);
  });
});
