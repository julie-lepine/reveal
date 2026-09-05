import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostSkuForUser } from "../js/core/purchases.js";
import {
  PLAY_PRODUCT_ID_HOST,
  PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE,
  PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE,
} from "../data/revenueCatConfig.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-HOST-02A/02B — SKUs + carte Menu", () => {
  it("déclare les SKUs Maître sans secret", () => {
    const config = src("data/revenueCatConfig.js");
    assert.match(config, /PLAY_PRODUCT_ID_HOST = "reveal_host"/);
    assert.match(config, /PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE = "reveal_host_upgrade_adfree"/);
    assert.match(config, /PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE = "reveal_host_upgrade_profile"/);
    assert.match(config, /REVENUECAT_ENTITLEMENT_HOST = "host"/);
    assert.equal(/\bsk_[A-Za-z0-9]/.test(config), false);
  });

  it("9,99 / 7 € / 3 € selon le palier déjà acheté", () => {
    assert.equal(hostSkuForUser({}), PLAY_PRODUCT_ID_HOST);
    assert.equal(
      hostSkuForUser({ adFree: false, profilePack: false, hostPack: false }),
      PLAY_PRODUCT_ID_HOST
    );
    assert.equal(
      hostSkuForUser({ adFree: true, profilePack: false, hostPack: false }),
      PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE
    );
    assert.equal(
      hostSkuForUser({ adFree: true, profilePack: true, hostPack: false }),
      PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE
    );
    assert.equal(
      hostSkuForUser({ adFree: false, profilePack: true, hostPack: false }),
      PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE
    );
  });

  it("purchases n’écrit pas host_pack en base", () => {
    const purchases = src("js/core/purchases.js");
    assert.equal(/\.from\(["']profiles["']\)/.test(purchases), false);
    assert.match(purchases, /purchaseHost/);
    assert.match(purchases, /refreshHostPackFromServerUntil/);
  });

  it("Menu Forfaits : carte 9,99 / 7,00 / 3,00", () => {
    const ui = src("js/core/hostPackUi.js");
    const settings = src("js/screens/settings.js");
    assert.match(settings, /hostPackSettingsCardHtml/);
    assert.match(settings, /purchaseHost/);
    assert.match(settings, /btn-host-buy/);
    assert.match(ui, /id="btn-host-buy"/);
    assert.match(ui, /9,99/);
    assert.match(ui, /7,00/);
    assert.match(ui, /3,00/);
    assert.match(src("js/config/premiumPacks.js"), /Maître de soirée/);
  });
});
