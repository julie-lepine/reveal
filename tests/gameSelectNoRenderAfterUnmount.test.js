/**
 * Point mineur de l'audit : en quittant le menu des jeux, un chargement encore en
 * cours (refreshGameSession) programmait un rafraîchissement après la sortie.
 * Inoffensif (l'écran courant est vérifié), mais ce minuteur n'était jamais arrêté.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "js/screens/gameSelect.js"), "utf8").replace(/\r\n/g, "\n");

describe("Menu des jeux : pas de rafraîchissement après la sortie", () => {
  it("scheduleRender ne programme plus rien une fois l'écran quitté", () => {
    assert.match(src, /function scheduleRender\(force = false\) \{\s*if \(disposed\) return;/);
  });

  it("la sortie de l'écran le signale avant d'arrêter les minuteurs", () => {
    assert.match(src, /return \(\) => \{\s*disposed = true;[\s\S]*?if \(renderTimer\) clearTimeout\(renderTimer\);/);
  });

  it("le chargement initial passe toujours par scheduleRender", () => {
    assert.match(src, /await refreshGameSession\(\);\s*scheduleRender\(true\);/);
  });
});
