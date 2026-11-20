/**
 * Guess the Lie, audit n°1 : si l'annonce du verdict échouait chez le vrai hôte,
 * son téléphone l'avait déjà enregistrée (« save local puis sync ») : il voyait le
 * verdict seul, les invités restaient sur le vote, et « Révéler maintenant » ne
 * faisait plus rien. Désormais : manche d'avant remise, message, nouvel essai possible.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REVEAL_FAILED_LABEL } from "../js/core/postGameFinish.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "js/games/guessLie.js"), "utf8").replace(/\r\n/g, "\n");

function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} introuvable`);
  return src.slice(start, src.indexOf("\n  }\n", start));
}

describe("Guess the Lie : verdict qui ne part pas", () => {
  it("échec : points retirés, manche d'avant remise, message, erreur remontée", () => {
    const body = fnBody("transitionToReveal");
    assert.match(
      body,
      /catch \(err\) \{\s*restoreEveningScores\(eveningBefore\);\s*roundScored = false;[\s\S]*?saveStatePatch\(\{ guessLie: gl \}\);\s*revealFailed = true;\s*throw err;/
    );
    // gl = la session lue au début, avant l'enregistrement « reveal ».
    assert.match(body, /^function transitionToReveal\(\) \{\s*const gl = getGuessLieSession\(\);/);
  });

  it("« Révéler maintenant » et l'annonce automatique attrapent l'échec", () => {
    assert.match(fnBody("tryAdvanceToReveal"), /catch \(err\) \{\s*onRevealFailed\(err\);/);
    assert.match(fnBody("forceReveal"), /catch \(err\) \{\s*onRevealFailed\(err\);/);
    assert.match(fnBody("onRevealFailed"), /syncFromGl\(\);\s*render\(\);/);
  });

  it("message sous « Révéler maintenant », remis à zéro à chaque manche", () => {
    assert.equal(REVEAL_FAILED_LABEL, "Le verdict n’est pas parti, réessaie !");
    assert.match(src, /revealFailed \? `<p class="hint">\$\{escapeHtml\(REVEAL_FAILED_LABEL\)\}<\/p>` : ""/);
    assert.match(fnBody("syncFromGl"), /if \(roundIdx !== prevIdx\) revealFailed = false;/);
    assert.match(fnBody("transitionToReveal"), /roundScored = true;\s*revealFailed = false;/);
  });
});
