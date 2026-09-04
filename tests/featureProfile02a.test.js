import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { profileSkuForUser } from "../js/core/purchases.js";
import {
  PLAY_PRODUCT_ID_PROFILE,
  PLAY_PRODUCT_ID_PROFILE_UPGRADE,
} from "../data/revenueCatConfig.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-PROFILE-02A/02B — SKUs + carte Menu", () => {
  it("déclare les SKUs Profil sans secret", () => {
    const config = src("data/revenueCatConfig.js");
    assert.match(config, /PLAY_PRODUCT_ID_PROFILE = "reveal_profile"/);
    assert.match(config, /PLAY_PRODUCT_ID_PROFILE_UPGRADE = "reveal_profile_upgrade"/);
    assert.match(config, /REVENUECAT_ENTITLEMENT_PROFILE = "profile"/);
    assert.equal(/\bsk_[A-Za-z0-9]/.test(config), false);
  });

  it("upgrade 4 € seulement si Sans pub sans Profil", () => {
    assert.equal(profileSkuForUser({}), PLAY_PRODUCT_ID_PROFILE);
    assert.equal(profileSkuForUser({ adFree: false, profilePack: false }), PLAY_PRODUCT_ID_PROFILE);
    assert.equal(
      profileSkuForUser({ adFree: true, profilePack: false }),
      PLAY_PRODUCT_ID_PROFILE_UPGRADE
    );
    assert.equal(
      profileSkuForUser({ adFree: true, profilePack: true }),
      PLAY_PRODUCT_ID_PROFILE
    );
  });

  it("purchases n’écrit pas profile_pack en base", () => {
    const purchases = src("js/core/purchases.js");
    assert.equal(/\.from\(["']profiles["']\)/.test(purchases), false);
    assert.match(purchases, /purchaseProfile/);
    assert.match(purchases, /restoreProfile/);
    assert.match(purchases, /refreshProfilePackFromServerUntil/);
  });

  it("Menu Profil : carte Acheter / Restaurer", () => {
    const ui = src("js/core/profilePackUi.js");
    const settings = src("js/screens/settings.js");
    assert.match(settings, /profilePackSettingsCardHtml/);
    assert.match(settings, /purchaseProfile/);
    assert.match(settings, /restoreProfile/);
    assert.match(ui, /id="btn-profile-buy"/);
    assert.match(ui, /id="btn-profile-restore"/);
    assert.match(ui, /6,99/);
    assert.match(ui, /4,00/);
    assert.equal(/btn-profile-refresh/.test(ui), false);
  });

  it("Sans pub : pas d’achat 2,99 si Profil (inclus)", () => {
    const ui = src("js/core/adFreeUi.js");
    assert.match(ui, /isProfilePack/);
    assert.match(ui, /PACK_SIGNATURE_LABEL/);
    assert.match(src("js/config/premiumPacks.js"), /Signature/);
  });
});
