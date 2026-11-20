/**
 * Tier Night (écran de fin de manche) : « Voir les résultats » côté hôte dont
 * l'envoi de la fin de partie échoue.
 * Avant : l'hôte partait seul aux résultats sans message, la session restait sur
 * le jeu. Désormais : l'hôte reste sur le récap, voit un message et peut réessayer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POST_GAME_FINISH_FAILED_LABEL } from "../js/core/postGameFinish.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../js/screens/tierNightEnd.js"), "utf8");

function hostFinishBlock() {
  const start = src.indexOf('await completeGameSession({ gameId: "tiernight", screen: "results"');
  assert.ok(start > 0, "appel completeGameSession introuvable");
  const end = src.indexOf("} else {", start);
  return src.slice(start, end);
}

describe("Tier Night : fin de partie qui échoue côté hôte", () => {
  it("échec : message, pas de départ seul aux résultats", () => {
    const catchPart = hostFinishBlock().split("catch (e)")[1];
    assert.ok(catchPart, "bloc catch introuvable");
    assert.doesNotMatch(catchPart, /navigate\(/);
    assert.match(catchPart, /finishFailed = true;\s*render\(\);/);
  });

  it("succès : on passe bien aux résultats", () => {
    const tryPart = hostFinishBlock().split("catch (e)")[0];
    assert.match(
      tryPart,
      /ensurePostGameScreen\("results", \{ from: "tiernight-end", gameId: "tiernight" \}\)/
    );
  });

  it("le message est affiché sous « Voir les résultats », pour l'hôte seulement", () => {
    assert.equal(POST_GAME_FINISH_FAILED_LABEL, "Les résultats ne sont pas partis, réessaie !");
    assert.match(
      src,
      /data-nav="results">Voir les résultats →<\/button>\$\{\s*finishFailed && realHost\s*\?\s*`<p class="hint">\$\{escapeHtml\(POST_GAME_FINISH_FAILED_LABEL\)\}<\/p>`/
    );
  });
});
