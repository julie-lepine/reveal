/**
 * N°11 de l'audit : sur l'écran des résultats, si l'hôte est parti, le joueur désigné
 * pour le remplacer peut « 👑 Reprendre l'animation » directement (puis « Recommencer »
 * apparaît), sans passer par le menu des jeux. Même bouton et même texte que le menu.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const cta = read("js/core/reclaimHostCta.js");
const results = read("js/screens/results.js");
const gameSelect = read("js/screens/gameSelect.js");

describe("Écran des résultats : reprendre l'animation", () => {
  it("bouton partagé : même texte, seulement pour le remplaçant désigné", () => {
    assert.match(cta, /👑 Reprendre l'animation/);
    assert.match(
      cta,
      /if \(!isGameSyncActive\(\) \|\| isLobbyHost\(\)\) return "";\s*if \(!clientMayOfferHostClaim\(\)\) return "";/
    );
  });

  it("le clic passe par la même confirmation que le menu des jeux", () => {
    assert.match(cta, /ensureLobbyHostOrOfferClaim\(\{ reason: "reclaim-cta" \}\)/);
  });

  it("le bouton est affiché avec ou sans dernière partie", () => {
    const matches = results.match(/\$\{reclaimHostCtaHtml\(\)\}/g) || [];
    assert.equal(matches.length, 2);
  });

  it("après la reprise, l'écran se redessine (le bouton « Recommencer » apparaît)", () => {
    assert.match(
      results,
      /bindReclaimHostButtons\(app, \{\s*onClaimed: \(\) => \{\s*if \(getCurrentScreen\(\) === "results"\) render\(\);/
    );
  });

  it("le menu des jeux utilise le même bouton", () => {
    assert.match(gameSelect, /import \{ reclaimHostCtaHtml \} from "\.\.\/core\/reclaimHostCta\.js";/);
    assert.doesNotMatch(gameSelect, /function reclaimHostCtaHtml\(/);
  });
});
