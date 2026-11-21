/**
 * Audit n°4 (points de soirée), points 3 et 4.
 *  3 : le vrai hôte réécrivait ses points sans reprendre ceux que le serveur
 *      venait d'ajouter (règle « hôte absent », fins de partie serveur) → effacés.
 *  4 : Guess the Lie n'avait pas de score de partie : les manches annoncées par
 *      un remplaçant ne comptaient pour personne d'autre que lui.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const sync = read("js/core/gameSync.js");

function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  return src.slice(start, src.indexOf("\n}\n", start));
}

describe("n°3 : l'hôte reprend les points du serveur avant d'écrire", () => {
  it("utilitaire : points, score des jeux, stats joueurs, compteurs, jeux de la soirée", () => {
    const fn = fnBody(sync, "export function absorbServerEveningScores(");
    assert.match(fn, /applyRemoteLobbyScores\(serverState\.scores\)/);
    assert.match(fn, /applyRemoteGameScores\(serverState\.gameScores, serverState\.gameScoreOrder\)/);
    assert.match(fn, /applyRemotePlayerStats\(serverState\.playerStats/);
    assert.match(fn, /mergeEveningStats\(getState\(\)\.stats, serverState\.stats\)/);
    assert.match(fn, /mergeEveningGamesRecorded\(/);
  });

  it("les points du téléphone sont fusionnés au maximum (jamais baissés)", () => {
    const fn = fnBody(sync, "export function applyRemoteLobbyScores(");
    assert.match(fn, /Math\.max\(merged\[name\] \|\| 0, pts\)/);
  });

  it("écriture pendant la partie : reprise depuis la ligne relue, puis envoi recalculé", () => {
    const fn = fnBody(sync, "async function patchGameStateInner(");
    const absorb = fn.indexOf("absorbServerEveningScores(freshRow.state);");
    assert.ok(absorb > fn.indexOf("loadSessionRowForPatch("));
    assert.match(fn, /if \(\(withEveningScores \|\| scoresOnly\) && freshRow\?\.state\) \{\s*absorbServerEveningScores\(freshRow\.state\);\s*mergePayload = \{ \.\.\.stateMerge, \.\.\.eveningStateToRemote\(\) \};/);
  });

  it("fin de partie et lancement d'une partie : relecture du serveur avant la réécriture complète", () => {
    const complete = fnBody(sync, "export async function completeGameSession(");
    const hostPart = complete.slice(complete.indexOf("const hostId = getState().lobby?.hostId"));
    assert.ok(hostPart.indexOf("fetchServerRowForEveningWrite(lobbyId)") < hostPart.indexOf("eveningStateToRemote()"));
    assert.match(hostPart, /const priorState = serverRow\?\.state \|\| cachedRow\?\.state \|\| \{\};/);
    const start = fnBody(sync, "export async function startGameSession(");
    assert.ok(start.indexOf("await fetchServerRowForEveningWrite(lobbyId);") < start.indexOf("eveningStateToRemote()"));
  });

  it("lecture ratée : comportement d'avant (pas de blocage)", () => {
    const fn = fnBody(sync, "async function fetchServerRowForEveningWrite(");
    assert.match(fn, /\} catch \{\s*return null;\s*\}/);
  });
});

describe("n°4 : Guess the Lie a un score de partie", () => {
  it("envoyé et reçu avec la partie", () => {
    assert.match(fnBody(sync, "export function guessLieToRemote("), /matchScores: scoresToRemote\(gl\.matchScores \|\| \{\}\)/);
    assert.match(fnBody(sync, "export function guessLieFromRemote("), /matchScores: scoresFromRemote\(remote\.matchScores \|\| \{\}\)/);
  });

  it("mis à jour à chaque révélation avec les mêmes points que la soirée", () => {
    const game = read("js/games/guessLie.js");
    const fn = game.slice(game.indexOf("async function transitionToReveal()"));
    assert.match(fn, /const award = awardGuessLieRound\(/);
    assert.match(fn, /matchScores\[name\] = \(Number\(matchScores\[name\]\) \|\| 0\) \+ award\.detectivePoints;/);
    assert.match(fn, /matchScores\[round\.player\] = \(Number\(matchScores\[round\.player\]\) \|\| 0\) \+ award\.liarPoints;/);
    assert.match(fn, /roundScored: true,\s*matchScores,/);
  });

  it("remis à zéro à chaque nouvelle partie", () => {
    assert.match(read("js/core/restartGame.js"), /roundScored: false,\s*\/\/[^\n]*\n\s*matchScores: \{\},/);
    assert.match(read("js/core/state.js"), /statsRecordedRoundIdx: -1,\s*matchScores: \{\},\s*\}\);/);
  });

  it("le remplaçant a le droit d'envoyer ce champ", () => {
    assert.match(read("js/core/gameSessionSecurity.js"), /"matchScores"/);
  });

  it("serveur : 'guesslie' ajouté à la règle « hôte absent », modification ciblée et rejouable", () => {
    const sql = read("supabase/fix-guesslie-evening-scores.sql");
    assert.match(sql, /pg_get_functiondef\(\s*'public\.game_sessions_credit_absent_host_evening_scores\(\)'::regprocedure/);
    assert.match(sql, /''truthmeter'', ''guesslie'''/);
    assert.match(sql, /if position\(v_new in v_def\) > 0 then/);
    assert.match(sql, /if v_count <> 1 then/);
  });
});
