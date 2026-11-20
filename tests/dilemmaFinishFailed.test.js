/**
 * Dilemma : « Voir les résultats » (fin de partie) dont l'envoi échoue.
 * Avant : l'hôte partait seul aux résultats (invités bloqués sur « En attente de
 * l'hôte… »), avec une partie déjà remise à zéro sur son téléphone.
 * Désormais : la partie est restaurée chez l'hôte, il reste sur le verdict,
 * voit un message et peut réessayer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POST_GAME_FINISH_FAILED_LABEL } from "../js/core/postGameFinish.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../js/games/dilemma.js"), "utf8");

function finishBlock() {
  const start = src.indexOf("const sessionBeforeReset = getDilemmaSession();");
  assert.ok(start > 0, "sauvegarde avant remise à zéro introuvable");
  const end = src.indexOf("} else {", src.indexOf("catch (e)", start));
  return src.slice(start, end);
}

describe("Dilemma : fin de partie qui échoue", () => {
  it("la partie est sauvegardée AVANT la remise à zéro locale", () => {
    const save = src.indexOf("const sessionBeforeReset = getDilemmaSession();");
    const reset = src.indexOf("await resetDilemmaAfterGame({ syncRemote: false })");
    assert.ok(save > 0 && reset > save);
  });

  it("échec : partie restaurée, message, pas de départ seul aux résultats", () => {
    const catchPart = finishBlock().split("catch (e)")[1];
    assert.ok(catchPart, "bloc catch introuvable");
    assert.doesNotMatch(catchPart, /navigate\(/);
    assert.match(catchPart, /saveStatePatch\(\{ dilemmaGame: sessionBeforeReset \}\)/);
    assert.match(catchPart, /finishFailed = true;\s*syncFromSession\(\);\s*render\(\);\s*return;/);
  });

  it("succès : on passe bien aux résultats", () => {
    const tryPart = finishBlock().split("catch (e)")[0];
    assert.match(tryPart, /ensurePostGameScreen\("results", \{ from: "dilemma", gameId: "dilemma" \}\)/);
  });

  it("le message est affiché sous le bouton de l'hôte", () => {
    assert.equal(POST_GAME_FINISH_FAILED_LABEL, "Les résultats ne sont pas partis, réessaie !");
    assert.match(
      src,
      /id="next-round">[\s\S]*?"Voir les résultats →"[\s\S]*?finishFailed\s*\?\s*`<p class="hint">\$\{escapeHtml\(POST_GAME_FINISH_FAILED_LABEL\)\}<\/p>`/
    );
  });
});
