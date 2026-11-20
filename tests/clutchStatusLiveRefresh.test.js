/**
 * Point mineur de l'audit : pendant le chrono caché, un tap d'un autre joueur ne
 * mettait à jour que les pastilles « a tapé ! ». La phrase sous le bouton restait
 * sur « C'est noté ! En attente des autres… » au lieu de « Tout le monde a tapé ! ».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "js/games/clutch.js"), "utf8");

function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} introuvable`);
  return src.slice(start, src.indexOf("\n  }\n", start));
}

describe("Clutch : phrase sous le bouton mise à jour en direct", () => {
  it("une seule source pour la phrase (rendu complet et mise à jour légère)", () => {
    const text = fnBody("activeStatusText");
    assert.match(text, /"Tout le monde a tapé !"/);
    assert.match(text, /"C'est noté ! En attente des autres…"/);
    assert.match(fnBody("activeHtml"), /const status = activeStatusText\(tapped, counting\);/);
  });

  it("la phrase a un identifiant pour être retrouvée", () => {
    assert.match(src, /<p class="hint" id="clutch-status" style="text-align:center">\$\{escapeHtml\(status\)\}<\/p>/);
  });

  it("un tap d'un autre joueur met à jour les pastilles ET la phrase, sans re-rendu complet", () => {
    const live = fnBody("refreshActiveLive");
    assert.match(live, /refreshTappedChips\(\);/);
    assert.match(live, /app\.querySelector\("#clutch-status"\)/);
    assert.match(live, /statusEl\.textContent = activeStatusText\(\);/);
    assert.doesNotMatch(live, /\brender\(\)/);
  });
});
