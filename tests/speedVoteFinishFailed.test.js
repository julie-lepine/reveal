/**
 * Speed Vote : « Voir les résultats » (fin de partie) dont l'envoi échoue.
 * Avant : l'hôte partait seul aux résultats, les invités restaient sur
 * « En attente de l'hôte… ». Désormais : l'hôte reste sur le verdict, voit
 * un message et peut réessayer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POST_GAME_FINISH_FAILED_LABEL } from "../js/core/postGameFinish.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../js/games/speedVote.js"), "utf8");

function finishBlock() {
  const start = src.indexOf('await completeGameSession({ gameId: "speedvote"');
  assert.ok(start > 0, "appel completeGameSession introuvable");
  const end = src.indexOf("} else {", start);
  return src.slice(start, end);
}

describe("Speed Vote : fin de partie qui échoue", () => {
  it("échec : message, pas de départ seul aux résultats", () => {
    const catchPart = finishBlock().split("catch (e)")[1];
    assert.ok(catchPart, "bloc catch introuvable");
    assert.doesNotMatch(catchPart, /navigate\(/);
    assert.match(catchPart, /finishFailed = true;\s*render\(\);/);
  });

  it("succès : on passe bien aux résultats", () => {
    const tryPart = finishBlock().split("catch (e)")[0];
    assert.match(tryPart, /ensurePostGameScreen\("results", \{ from: "speedvote", gameId: "speedvote" \}\)/);
  });

  it("le message est affiché sous le bouton de l'hôte", () => {
    assert.equal(POST_GAME_FINISH_FAILED_LABEL, "Les résultats ne sont pas partis, réessaie !");
    assert.match(
      src,
      /id="next-round">[\s\S]*?"Voir les résultats →"[\s\S]*?finishFailed\s*\?\s*`<p class="hint">\$\{escapeHtml\(POST_GAME_FINISH_FAILED_LABEL\)\}<\/p>`/
    );
  });
});
