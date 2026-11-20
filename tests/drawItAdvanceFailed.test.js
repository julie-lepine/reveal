/**
 * Audit Draw It n°3, n°4 et n°6.
 *  n°3 : « Manche suivante » / « Voir les résultats » échouaient sans message.
 *  n°6 : « Manche suivante » relancée après une réponse perdue : le serveur
 *        refuse le second appel, mais la manche a bien démarré → pas un échec.
 *  n°4 : le mot du dessinateur n'était lu qu'une fois (« … » si la lecture ratait).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const session = read("js/core/drawItSession.js");
const game = read("js/games/drawIt.js");

function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  return src.slice(start, src.indexOf("\n}\n", start));
}

describe("Draw It n°3 / n°6 : manche suivante", () => {
  const fn = fnBody(session, "export async function commitDrawItNextRound(");

  it("une erreur du serveur est attrapée, puis la partie relue", () => {
    assert.match(fn, /try \{[\s\S]*rpcAdvanceDrawItRound[\s\S]*\} catch \{[\s\S]*refreshGameSession\(\)/);
  });

  it("si la manche suivante a démarré quand même, c'est un succès", () => {
    const catchPart = fn.slice(fn.indexOf("} catch {"));
    assert.match(catchPart, /return reachedNext\(\)\s*\?\s*\{ ok: true, reason: null \}\s*:\s*\{ ok: false, reason: "rpc_failed" \}/);
    assert.match(fn, /synced\.phase === "drawing" &&\s*Number\(synced\.roundIdx\) === Number\(check\.nextIdx\)/);
  });
});

describe("Draw It n°3 : voir les résultats", () => {
  it("les erreurs (points, fin de partie) sont attrapées", () => {
    const fn = fnBody(session, "export async function commitDrawItComplete(");
    assert.match(fn, /try \{[\s\S]*rpcFinalizeDrawItScores[\s\S]*await completeGameSession\(\{ gameId: "drawit"[\s\S]*\} catch \{\s*return \{ ok: false, reason: "rpc_failed" \};/);
  });
});

describe("Draw It n°3 : message sous le bouton de l'hôte", () => {
  it("échec : message, l'hôte reste sur le récapitulatif et peut réessayer", () => {
    assert.match(game, /advanceFailed\s*\?\s*`<p class="hint">\$\{escapeHtml\(\s*last \? POST_GAME_FINISH_FAILED_LABEL : NEXT_ROUND_FAILED_LABEL\s*\)\}<\/p>`/);
    assert.match(game, /if \(done\.reason === "in_flight"\) return;\s*advanceFailed = true;/);
    assert.match(game, /advanceFailed = next\?\.ok === false && next\.reason !== "in_flight";/);
  });

  it("le message disparaît dès que la partie avance", () => {
    assert.match(game, /if \(phase !== DRAW_IT_PHASE_REVEAL\) advanceFailed = false;/);
  });

  it("mêmes messages que les autres jeux", () => {
    assert.match(game, /import \{\s*NEXT_ROUND_FAILED_LABEL,\s*POST_GAME_FINISH_FAILED_LABEL,\s*\} from "\.\.\/core\/postGameFinish\.js";/);
  });
});

describe("Draw It n°4 : mot du dessinateur", () => {
  it("lecture ratée : nouveaux essais en arrière-plan (8 × 500 ms)", () => {
    assert.match(game, /if \(!privateWord && retry\) schedulePrivateWordRetry\(session\);/);
    assert.match(game, /const PRIVATE_WORD_RETRY_MAX = 8;/);
    assert.match(game, /const PRIVATE_WORD_RETRY_DELAY_MS = 500;/);
  });

  it("arrêt si la manche a changé, si le mot est arrivé, ou au démontage", () => {
    const fn = fnBody(game, "  function schedulePrivateWordRetry(").replace(/\n {2}/g, "\n");
    assert.match(fn, /`\$\{live\.runId\}:\$\{live\.roundIdx\}` !== roundKey/);
    assert.match(fn, /privateWord \|\|/);
    assert.match(fn, /patchDrawerWord\(getDrawItSession\(\)\);/);
    assert.match(game, /stopTick\(\);\s*clearTimeout\(privateWordRetryId\);/);
  });
});
