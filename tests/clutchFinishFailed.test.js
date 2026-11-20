/**
 * Clutch : « Voir les résultats » (fin de partie) dont l'envoi échoue.
 * Avant : l'hôte partait seul aux résultats, les invités restaient sur
 * « En attente de l'hôte… ». Désormais : l'hôte reste sur le verdict, voit
 * un message et peut réessayer (le bouton est toujours là).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clutchSrc = readFileSync(join(__dirname, "../js/games/clutch.js"), "utf8");
const sessionSrc = readFileSync(join(__dirname, "../js/core/clutchSession.js"), "utf8");

/** Bloc multijoueur de la fin de partie (du try au else solo). */
function finishBlock() {
  const start = clutchSrc.indexOf('await completeGameSession({ gameId: "clutch"');
  assert.ok(start > 0, "appel completeGameSession introuvable");
  const end = clutchSrc.indexOf("} else {", start);
  return clutchSrc.slice(start, end);
}

describe("Clutch : fin de partie qui échoue", () => {
  it("en cas d'échec, l'hôte n'est plus envoyé seul aux résultats", () => {
    const catchPart = finishBlock().split("catch (e)")[1];
    assert.ok(catchPart, "bloc catch introuvable");
    assert.doesNotMatch(catchPart, /navigate\(/);
    assert.match(catchPart, /finishFailed = true;\s*render\(\);/);
  });

  it("en cas de succès, on passe bien aux résultats", () => {
    const tryPart = finishBlock().split("catch (e)")[0];
    assert.match(tryPart, /ensurePostGameScreen\("results", \{ from: "clutch", gameId: "clutch" \}\)/);
  });

  it("le message est affiché sous le bouton de l'hôte", () => {
    assert.match(
      clutchSrc,
      /finishFailed\s*\?\s*`<p class="hint">\$\{escapeHtml\(CLUTCH_FINISH_FAILED_LABEL\)\}<\/p>`/
    );
    assert.match(sessionSrc, /CLUTCH_FINISH_FAILED_LABEL = "Les résultats ne sont pas partis, réessaie !"/);
  });

  it("le bouton « Voir les résultats » reste proposé à l'hôte sur le verdict", () => {
    assert.match(clutchSrc, /id="next-round"[\s\S]*?"Voir les résultats →"/);
  });
});
