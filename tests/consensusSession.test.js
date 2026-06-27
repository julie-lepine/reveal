import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONSENSUS_DEFAULT_SLIDER_VALUE } from "../data/consensus.js";
import {
  applyConsensusDefaultAnswers,
  clampConsensusValue,
  isConsensusAnswerForRound,
  isScorableConsensusAnswer,
  pickLatestConsensusAnswer,
  stripStaleConsensusAnswers,
} from "../js/core/consensusAnswerUtils.js";

describe("clampConsensusValue", () => {
  it("utilise 50 % par défaut pour null / undefined / vide", () => {
    assert.equal(clampConsensusValue(null), CONSENSUS_DEFAULT_SLIDER_VALUE);
    assert.equal(clampConsensusValue(undefined), CONSENSUS_DEFAULT_SLIDER_VALUE);
    assert.equal(clampConsensusValue(""), CONSENSUS_DEFAULT_SLIDER_VALUE);
    assert.equal(clampConsensusValue("nope"), CONSENSUS_DEFAULT_SLIDER_VALUE);
  });

  it("conserve 0 % si choisi explicitement", () => {
    assert.equal(clampConsensusValue(0), 0);
    assert.equal(clampConsensusValue("0"), 0);
  });
});

describe("isConsensusAnswerForRound", () => {
  it("ignore submittedAt sans questionIdx (réponse stale)", () => {
    assert.equal(
      isConsensusAnswerForRound({ value: 0, submittedAt: 1, questionIdx: null }, 1),
      false
    );
    assert.equal(
      isConsensusAnswerForRound({ value: 80, submittedAt: 1, questionIdx: 0 }, 1),
      false
    );
  });

  it("accepte une réponse validée pour la manche courante", () => {
    assert.equal(
      isConsensusAnswerForRound(
        { value: 65, submittedAt: 2, questionIdx: 1 },
        1
      ),
      true
    );
  });
});

describe("isScorableConsensusAnswer", () => {
  it("accepte une vraie réponse validée pour la manche", () => {
    assert.equal(
      isScorableConsensusAnswer(
        { value: 80, submittedAt: 1, questionIdx: 0, imputed: false },
        0
      ),
      true
    );
  });

  it("exclut une réponse imputée (joueur absent à 50 %)", () => {
    assert.equal(
      isScorableConsensusAnswer(
        { value: 50, submittedAt: 1, questionIdx: 0, imputed: true },
        0
      ),
      false
    );
  });

  it("exclut une réponse d'une autre manche", () => {
    assert.equal(
      isScorableConsensusAnswer(
        { value: 80, submittedAt: 1, questionIdx: 1, imputed: false },
        0
      ),
      false
    );
  });
});

describe("stripStaleConsensusAnswers", () => {
  it("purge les réponses d'une manche précédente", () => {
    const out = stripStaleConsensusAnswers(
      {
        Alice: { value: 0, submittedAt: 1, questionIdx: 1 },
        Bob: { value: 70, submittedAt: 2, questionIdx: 2 },
      },
      2
    );
    assert.equal(out.Alice, undefined);
    assert.equal(out.Bob?.value, 70);
  });
});

describe("applyConsensusDefaultAnswers", () => {
  it("impute 50 % aux joueurs actifs sans réponse validée", () => {
    const out = applyConsensusDefaultAnswers(
      {
        phase: "question",
        questionIdx: 0,
        answers: {
          Alice: { value: 40, submittedAt: 1, questionIdx: 0 },
        },
        matchScores: {},
      },
      ["Alice", "Bob"]
    );
    assert.equal(out.answers.Alice.value, 40);
    assert.equal(out.answers.Bob.value, CONSENSUS_DEFAULT_SLIDER_VALUE);
    assert.equal(out.answers.Bob.imputed, true);
    assert.equal(out.answers.Bob.questionIdx, 0);
  });
});

describe("pickLatestConsensusAnswer", () => {
  it("préfère une réponse validée à une réponse imputée", () => {
    const local = {
      value: 72,
      timestamp: 1000,
      submittedAt: 1000,
      questionIdx: 0,
      imputed: false,
    };
    const remote = {
      value: 50,
      timestamp: 2000,
      submittedAt: 2000,
      questionIdx: 0,
      imputed: true,
    };
    assert.deepEqual(pickLatestConsensusAnswer(local, remote), local);
    assert.deepEqual(pickLatestConsensusAnswer(remote, local), local);
  });

  it("garde le timestamp le plus récent entre deux réponses non imputées", () => {
    const older = { value: 40, timestamp: 100, submittedAt: 100, imputed: false };
    const newer = { value: 60, timestamp: 200, submittedAt: 200, imputed: false };
    assert.deepEqual(pickLatestConsensusAnswer(older, newer), newer);
    assert.deepEqual(pickLatestConsensusAnswer(newer, older), newer);
  });
});
