/**
 * Audit « votes de l'hôte » : le vote / la réponse / le « vu » de l'hôte réel passe
 * par la même RPC que les invités (contribute_game_session_player) dans 8 jeux.
 * Avant, l'hôte relisait puis réécrivait toute la partie : un vote d'invité arrivé
 * entre les deux était effacé du serveur (l'invité se voyait « voté », compté
 * « pas voté »).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectPlayerContribution,
  isHostPlayerContribution,
} from "../js/core/playerContribution.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const HOST = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/** Envoi exact de chaque jeu (voir le rapport tmp/audit-votes-hote-tous-jeux.md). */
const HOST_SENDS = [
  ["Hot Take, vote", { hotTake: { votes: { [HOST]: "A" } } }, "hottake", "vote"],
  ["Dilemma, vote", { dilemma: { votes: { [HOST]: "B" } } }, "dilemma", "vote"],
  ["Speed Vote, vote", { speedVote: { votes: { [HOST]: "uid-bob" } } }, "speedvote", "vote"],
  ["Wrong Answer, réponse", { wrongAnswer: { answers: { [HOST]: { text: "x" } } } }, "wronganswer", "answer"],
  ["Wrong Answer, vote", { wrongAnswer: { votes: { [HOST]: "uid-bob" } } }, "wronganswer", "vote"],
  ["Guess the Lie, vote", { guessLie: { votes: { [HOST]: 2 } } }, "guesslie", "vote"],
  ["Le Traître, vote", { traitre: { votes: { [HOST]: "uid-bob" } } }, "traitre", "vote"],
  ["Le Traître, « vu »", { traitre: { dealAcks: { [HOST]: true } } }, "traitre", "deal_ack"],
  ["Tier Night Live, vote", { tierNightLive: { votes: { [HOST]: "S" } } }, "tiernightlive", "vote"],
  ["Clutch, tap", { clutch: { taps: { [HOST]: { ms: 1, at: 1 } } } }, "clutch", "tap"],
];

describe("Vote de l'hôte : même RPC que les invités", () => {
  for (const [label, patch, game, kind] of HOST_SENDS) {
    it(`${label} → contribution serveur`, () => {
      const c = detectPlayerContribution(patch, HOST);
      assert.equal(c?.game, game);
      assert.equal(c?.kind, kind);
      assert.equal(isHostPlayerContribution(c), true);
    });
  }

  it("exclus : Trivia et Consensus (réponses), Truth Meter (vote), « prêt », envois des mensonges", () => {
    const excluded = [
      { trivia: { answers: { [HOST]: { index: 1 } } } },
      { consensus: { answers: { [HOST]: { value: 40 } } } },
      { truthMeter: { votes: { [HOST]: 70 } } },
      { hotTake: { ready: { [HOST]: true } } },
      { guessLie: { submissions: { [HOST]: { lie: 0 } } } },
    ];
    for (const patch of excluded) {
      assert.equal(isHostPlayerContribution(detectPlayerContribution(patch, HOST)), false, JSON.stringify(patch));
    }
  });

  it("les écritures de jeu (plusieurs champs) gardent leur chemin habituel", () => {
    const reveal = detectPlayerContribution(
      { hotTake: { phase: "reveal", votes: { [HOST]: "A" } } },
      HOST
    );
    assert.equal(reveal, null);
    assert.equal(isHostPlayerContribution(reveal), false);
  });

  it("le vote d'un autre joueur n'est jamais envoyé au nom de l'hôte", () => {
    assert.equal(detectPlayerContribution({ hotTake: { votes: { "uid-bob": "A" } } }, HOST), null);
  });

  it("chaque jeu envoie bien ce patch (forme vérifiée dans le code)", () => {
    const sources = {
      "js/core/hotTakeSession.js": /patchGameStateWithFeedback\(\{ hotTake: \{ votes: \{ \[uid\]: choice \} \} \}\)/,
      "js/core/dilemmaSession.js": /patchGameStateWithFeedback\(\{ dilemma: \{ votes: \{ \[uid\]: choice \} \} \}\)/,
      "js/core/speedVoteSession.js": /patchGameStateWithFeedback\(\{ speedVote: \{ votes: \{ \[uid\]: choice \} \} \}\)/,
      "js/core/traitreSession.js": /patchGameStateWithFeedback\(\{ traitre: \{ votes: \{ \[uid\]: targetUid \} \} \}\)/,
    };
    for (const [file, re] of Object.entries(sources)) {
      assert.match(read(file), re, file);
    }
    assert.match(read("js/core/traitreSession.js"), /\{ traitre: \{ dealAcks: \{ \[uid\]: true \} \} \}/);
    assert.match(read("js/core/wrongAnswerSession.js"), /\{ wrongAnswer: \{ answers: \{ \[uid\]: answer \} \} \}/);
    assert.match(read("js/core/wrongAnswerSession.js"), /\{ wrongAnswer: \{ votes: \{ \[uid\]: targetUid \} \} \}/);
    assert.match(read("js/core/guessLieSession.js"), /\{ guessLie: \{ votes: \{ \[uid\]: pick \} \} \}/);
    assert.match(read("js/core/tierNightLiveSession.js"), /\{ tierNightLive: \{ votes: \{ \[uid\]: tier \} \} \}/);
  });

  it("l'hôte réel passe par la RPC avant toute réécriture de la partie", () => {
    const src = read("js/core/gameSync.js");
    const inner = src.slice(src.indexOf("async function patchGameStateInner"));
    const routeAt = inner.indexOf("if (isHostPlayerContribution(hostContribution))");
    const rewriteAt = inner.indexOf("let mergePayload = stateMerge;");
    assert.ok(routeAt > 0 && rewriteAt > routeAt);
  });
});
