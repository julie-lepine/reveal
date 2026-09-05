import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  entitlementPatch,
  eventTouchesHost,
} from "../supabase/revenuecat-entitlement-patch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-HOST-02B — webhook Maître de soirée", () => {
  it("GRANT 9,99 pose host + Signature + Sans pub", () => {
    assert.deepEqual(entitlementPatch("INITIAL_PURCHASE", { product_id: "reveal_host" }), {
      host_pack: true,
      profile_pack: true,
      ad_free: true,
    });
    assert.equal(eventTouchesHost({ entitlement_ids: ["host"] }), true);
  });

  it("GRANT 7 € (depuis Sans pub) pose host + Signature + Sans pub", () => {
    assert.deepEqual(
      entitlementPatch("NON_RENEWING_PURCHASE", { product_id: "reveal_host_upgrade_adfree" }),
      { host_pack: true, profile_pack: true, ad_free: true }
    );
  });

  it("GRANT 3 € (depuis Signature) pose host + Signature + Sans pub", () => {
    assert.deepEqual(
      entitlementPatch("NON_RENEWING_PURCHASE", { product_id: "reveal_host_upgrade_profile" }),
      { host_pack: true, profile_pack: true, ad_free: true }
    );
  });

  it("REFUND 3 € retire Maître et garde Signature", () => {
    assert.deepEqual(
      entitlementPatch("REFUND", { product_id: "reveal_host_upgrade_profile" }),
      { host_pack: false }
    );
  });

  it("REFUND 7 € retire Maître et Signature, garde Sans pub", () => {
    assert.deepEqual(
      entitlementPatch("REFUND", { product_id: "reveal_host_upgrade_adfree" }),
      { host_pack: false, profile_pack: false }
    );
  });

  it("REFUND 9,99 retire les trois", () => {
    assert.deepEqual(entitlementPatch("REFUND", { product_id: "reveal_host" }), {
      host_pack: false,
      profile_pack: false,
      ad_free: false,
    });
  });

  it("RESTORE pose les mêmes flags qu’un achat", () => {
    assert.deepEqual(entitlementPatch("RESTORE", { product_id: "reveal_host" }), {
      host_pack: true,
      profile_pack: true,
      ad_free: true,
    });
    assert.match(src("supabase/functions/revenuecat-webhook/index.ts"), /eventTouchesHost/);
  });

  it("GRANT/REVOKE Signature seul ne touche pas host_pack", () => {
    assert.deepEqual(entitlementPatch("INITIAL_PURCHASE", { product_id: "reveal_profile" }), {
      profile_pack: true,
      ad_free: true,
    });
    assert.equal("host_pack" in entitlementPatch("REFUND", { product_id: "reveal_profile" }), false);
  });
});
