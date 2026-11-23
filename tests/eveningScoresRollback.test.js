/**
 * Les points d'une manche étaient ajoutés sur le téléphone de l'hôte AVANT l'envoi
 * de la révélation, et jamais retirés si l'envoi échouait : un nouvel essai les
 * ajoutait une deuxième fois (Clutch : à chaque relance automatique), puis ils
 * partaient au serveur avec l'envoi suivant. Désormais : copie avant, remise si échec.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addScore,
  bumpPlayerStat,
  getState,
  restoreEveningScores,
  setActiveScoringGame,
  snapshotEveningScores,
} from "../js/core/state.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("Points de soirée : copie et remise", () => {
  it("échec d'envoi : les points de la manche sont retirés (y compris détail par jeu et stats)", () => {
    setActiveScoringGame("zz-test-game");
    addScore("Testeur", 2);
    const before = snapshotEveningScores();
    const scoreBefore = getState().scores.Testeur;

    // Essai 1 : points ajoutés, puis envoi raté → remise.
    addScore("Testeur", 3);
    bumpPlayerStat("Testeur", "testStat", 1);
    assert.equal(getState().scores.Testeur, scoreBefore + 3);
    restoreEveningScores(before);
    assert.equal(getState().scores.Testeur, scoreBefore);
    assert.equal(getState().gameScores["zz-test-game"].Testeur, 2);
    assert.equal(getState().playerStats?.Testeur?.testStat ?? 0, 0);

    // Essai 2 réussi : les points ne sont comptés qu'une fois.
    addScore("Testeur", 3);
    assert.equal(getState().scores.Testeur, scoreBefore + 3);
    setActiveScoringGame(null);
  });

  it("la copie est indépendante de l'état (pas de partage d'objets)", () => {
    const snap = snapshotEveningScores();
    snap.scores.Fantome = 99;
    assert.equal(getState().scores.Fantome, undefined);
  });
});

describe("Les 6 jeux : copie avant les points, remise si l'envoi échoue", () => {
  const GAMES = {
    "js/games/clutch.js": /restoreEveningScores\(eveningBefore\);\s*throw err;/,
    "js/games/dilemma.js": /roundScored = Boolean\(getDilemmaSession\(\)\.roundScored\);\s*restoreEveningScores\(eveningBefore\);/,
    "js/games/hotTake.js": /if \(getHotTakeSession\(\)\.phase !== "reveal"\) restoreEveningScores\(eveningBefore\);/,
    "js/games/speedVote.js": /if \(getSpeedVoteSession\(\)\.phase !== "reveal"\) \{\s*restoreEveningScores\(eveningBefore\);/,
    "js/games/wrongAnswer.js": /if \(getWrongAnswerSession\(\)\.phase !== "reveal"\) \{\s*restoreEveningScores\(eveningBefore\);/,
    "js/games/guessLie.js": /restoreEveningScores\(eveningBefore\);\s*roundScored = false;[\s\S]{0,400}?throw err;/,
  };
  const AWARD = {
    "js/games/clutch.js": "awardClutchRound(",
    "js/games/dilemma.js": "awardDilemmaRound(",
    "js/games/hotTake.js": "awardHotTakeVotes(",
    "js/games/speedVote.js": "awardSpeedVoteRound(",
    "js/games/wrongAnswer.js": "awardWrongAnswerRound(",
    "js/games/guessLie.js": "awardGuessLieRound(",
  };
  for (const [file, restoreRe] of Object.entries(GAMES)) {
    it(file, () => {
      const src = read(file);
      const snapAt = src.indexOf("const eveningBefore = snapshotEveningScores();");
      const awardAt = src.indexOf(AWARD[file], snapAt);
      assert.ok(snapAt > 0 && awardAt > snapAt, "copie prise avant l'ajout des points");
      assert.match(src, restoreRe);
    });
  }
});
