/**
 * Audit n°4 — points de soirée de fin de partie, Trivia et Consensus.
 * Avant : ajoutés sur le téléphone de celui qui termine. Remplaçant → perdus
 * pour les autres ; Trivia → comptés deux fois si l'écran était rouvert.
 * Maintenant : finalize_trivia_scores / finalize_consensus_scores, une fois par partie.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { consensusEveningDeltas, triviaEveningDeltas } from "../js/core/eveningFinalize.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("Calcul (miroir du serveur)", () => {
  it("Trivia : score du quiz + bonus podium 15 / 10 / 5", () => {
    assert.deepEqual(triviaEveningDeltas({ a: 40, b: 30, c: 20, d: 10 }, ["a", "b", "c", "d"]), {
      a: 55,
      b: 40,
      c: 25,
      d: 10,
    });
  });

  it("Trivia : ex aequo = même rang (rang suivant sauté)", () => {
    assert.deepEqual(triviaEveningDeltas({ a: 30, b: 30, c: 10 }, ["a", "b", "c"]), {
      a: 45,
      b: 45,
      c: 15,
    });
  });

  it("Trivia : seuls les membres du salon, 0 si pas de score (comme l'appli)", () => {
    assert.deepEqual(triviaEveningDeltas({ a: 20, gone: 50 }, ["a", "b"]), { a: 35, b: 10 });
  });

  it("Consensus : score de la partie s'il est positif, sans bonus", () => {
    assert.deepEqual(consensusEveningDeltas({ a: 12, b: 0, gone: 9 }, ["a", "b"]), { a: 12 });
  });
});

describe("Écrans : le serveur ajoute les points en multijoueur", () => {
  it("Trivia : plus d'ajout local en multijoueur, appel serveur avant les résultats", () => {
    const src = read("js/games/trivia.js");
    const start = src.indexOf("async function finishTriviaGame()");
    const mpBlock = src.slice(start, src.indexOf("} else if (!eveningPodiumApplied)", start));
    assert.match(mpBlock, /await finalizeEveningScoresOnServer\("trivia"\);/);
    assert.doesNotMatch(mpBlock, /applyLobbyPodium|recordTriviaPlayed/);
    assert.match(mpBlock, /trivia\.getPodiumAwards\(/);
  });

  it("Consensus : appel serveur à chaque essai, ajout local seulement hors ligne", () => {
    const src = read("js/games/consensus.js");
    const start = src.indexOf("async function finishConsensusGame()");
    const fn = src.slice(start, src.indexOf("function finalConsensusSession()", start));
    assert.match(fn, /if \(!mp\) \{\s*const standings = consensus\.applyLobbyPodium/);
    const mpPart = fn.slice(fn.lastIndexOf("if (mp) {"));
    assert.match(mpPart, /await finalizeEveningScoresOnServer\("consensus"\);/);
    assert.doesNotMatch(mpPart, /applyLobbyPodium|recordConsensusPlayed/);
  });

  it("appel RPC limité aux deux fonctions de fin de partie", () => {
    const rpc = read("js/core/gameSessionRpc.js");
    assert.match(rpc, /rpc !== "finalize_trivia_scores" && rpc !== "finalize_consensus_scores"/);
  });
});

describe("Migration serveur", () => {
  const sql = read("supabase/fix-evening-scores-trivia-consensus.sql");

  it("hôte ou remplaçant, partie verrouillée", () => {
    for (const fn of ["finalize_trivia_scores", "finalize_consensus_scores"]) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}`));
      assert.match(body, /is_lobby_host\(p_lobby_id\) or public\.is_acting_host\(p_lobby_id\)/);
      assert.match(body, /for update;/);
      assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to authenticated;`));
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(uuid\\) from anon;`));
    }
  });

  it("une fois par partie, vérifié avant le contrôle « partie terminée »", () => {
    const trivia = sql.slice(sql.indexOf("create or replace function public.finalize_trivia_scores"));
    assert.ok(trivia.indexOf("eveningFinalized'->>'trivia'") < trivia.indexOf("TRIVIA_NOT_FINAL"));
    const consensus = sql.slice(sql.indexOf("create or replace function public.finalize_consensus_scores"));
    assert.match(consensus, /v_marker := md5\(\(v_blob->'deck'\)::text\);/);
    assert.ok(
      consensus.indexOf("eveningFinalized'->>'consensus'") <
        consensus.lastIndexOf("raise exception 'CONSENSUS_NOT_FINAL'")
    );
  });

  it("Trivia : rang compétition et bonus 15 / 10 / 5 sur les membres du salon", () => {
    assert.match(sql, /rank\(\) over \(order by s desc\) as rk/);
    assert.match(sql, /case rk when 1 then 15 when 2 then 10 when 3 then 5 else 0 end/);
    assert.match(sql, /from public\.lobby_members lm\s*where lm\.lobby_id = p_lobby_id/);
  });

  it("ajoute points de soirée, score du jeu, ordre, jeu de la soirée, compteur", () => {
    const helper = sql.slice(sql.indexOf("create or replace function public.evening_finalize_credit"));
    for (const key of ["'scores'", "'gameScores'", "'gameScoreOrder'", "'eveningGamesRecorded'", "'stats'", "'eveningFinalized'"]) {
      assert.ok(helper.includes(key), key);
    }
    assert.match(sql, /'trivia', v_deltas, 'triviaGamesPlayed', v_run/);
    assert.match(sql, /'consensus', v_deltas, 'consensusGamesPlayed', v_marker/);
    assert.match(sql, /revoke all on function public\.evening_finalize_credit\(jsonb, text, jsonb, text, text\) from authenticated;/);
  });
});
