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

describe("FEATURE-ADFREE promo hub + Forfaits", () => {
  it("hub : carte sous le récap, CTA vers Forfaits", () => {
    const gs = src("js/screens/gameSelect.js");
    const recapIdx = gs.indexOf("${eveningRecapHtml(recap)}");
    const hubIdx = gs.indexOf("${adFreeHubCardHtml()}");
    const gridIdx = gs.indexOf('gameGridSection("🎮 Jeux disponibles"');
    assert.ok(recapIdx > 0 && hubIdx > recapIdx && gridIdx > hubIdx);
    assert.match(gs, /SETTINGS_TAB\.FORFAITS/);
    assert.match(gs, /goToEveningSettings\(\{\s*tab:\s*SETTINGS_TAB\.FORFAITS\s*\}\)/);
    assert.match(gs, /adFree:\s*isAdFree\(\)/);
    assert.match(src("style.css"), /\.adfree-hub-card\{/);
  });

  it("hub : le bloc entier est le bouton, masqué si Sans pub", () => {
    const ui = src("js/core/adFreeUi.js");
    const hub = ui.slice(ui.indexOf("export function adFreeHubCardHtml"));
    assert.match(ui, /export function shouldShowAdFreePromo/);
    assert.match(ui, /return !isAdFree\(\)/);
    assert.match(hub, /if \(!shouldShowAdFreePromo\(\)\) return ""/);
    assert.match(hub, /<button type="button" class="adfree-hub-card" id="btn-adfree-hub">/);
    assert.equal(hub.includes("btn-primary"), false);
    assert.equal(hub.includes("Voir l"), false);
    assert.match(src("style.css"), /color-mix\(in srgb, var\(--color-primary\) 22%/);
  });

  it("settings lit params.tab forfaits au mount", () => {
    const settings = src("js/screens/settings.js");
    assert.match(settings, /function initialSettingsTab/);
    assert.match(settings, /getScreenParams\(\)\?\.tab/);
    assert.match(settings, /consumePendingSettingsTab/);
    assert.match(settings, /resolveSettingsTab/);
    assert.match(settings, /let activeTab = initialSettingsTab\(\)/);
    assert.match(src("js/screens/nav.js"), /tab \? \{ tab \} : null/);
    assert.match(src("js/config/settingsTabs.js"), /FORFAITS:\s*"forfaits"/);
  });
});
