import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guessLieLiarWins } from "../js/core/scoring.js";

describe("guessLieLiarWins", () => {
  it("accorde le bonus dès la moitié exacte", () => {
    assert.equal(guessLieLiarWins(2, 4), true);
    assert.equal(guessLieLiarWins(1, 2), true);
  });

  it("accorde le bonus quand plus de la moitié est trompée", () => {
    assert.equal(guessLieLiarWins(2, 6), true);
    assert.equal(guessLieLiarWins(0, 3), true);
  });

  it("refuse le bonus quand une majorité a trouvé", () => {
    assert.equal(guessLieLiarWins(3, 4), false);
    assert.equal(guessLieLiarWins(2, 3), false);
  });

  it("refuse le bonus s'il n'y a aucun votant", () => {
    assert.equal(guessLieLiarWins(0, 0), false);
  });
});
