/**
 * Trivia : « Voir les résultats » (fin de partie) dont l'envoi échoue.
 * Avant : l'hôte partait seul aux résultats, les invités restaient sur
 * « En attente de l'hôte… ». Désormais : l'hôte reste sur l'écran, voit
 * un message et peut réessayer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POST_GAME_FINISH_FAILED_LABEL } from "../js/core/postGameFinish.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../js/games/trivia.js"), "utf8");

function showResultsBlock() {
  const start = src.indexOf("async function showEveningResults");
  assert.ok(start > 0, "showEveningResults introuvable");
  return src.slice(start, src.indexOf("await setLobbyWaiting();", start));
}

describe("Trivia : fin de partie qui échoue", () => {
  it("échec : message, pas de départ seul aux résultats", () => {
    const catchPart = showResultsBlock().split("catch (e)")[1];
    assert.ok(catchPart, "bloc catch introuvable");
    assert.doesNotMatch(catchPart, /navigate\(/);
    assert.match(catchPart, /finishFailed = true;\s*render\(\);/);
  });

  it("succès : on passe bien aux résultats", () => {
    const tryPart = showResultsBlock().split("catch (e)")[0];
    assert.match(tryPart, /ensurePostGameScreen\("results", \{ from: "trivia", gameId: "trivia" \}\)/);
  });

  it("le message est affiché sous les deux boutons « Voir les résultats »", () => {
    assert.equal(POST_GAME_FINISH_FAILED_LABEL, "Les résultats ne sont pas partis, réessaie !");
    assert.match(
      src,
      /finishFailed \? `<p class="hint">\$\{escapeHtml\(POST_GAME_FINISH_FAILED_LABEL\)\}<\/p>` : ""/
    );
    assert.match(src, /"Voir les résultats →"\}\s*<\/button>\$\{finishFailedHtml\(\)\}/);
    assert.match(src, /data-trivia-action="show-results">Voir les résultats<\/button>\$\{finishFailedHtml\(\)\}/);
  });
});
