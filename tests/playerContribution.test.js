import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectPlayerContribution,
  stateKeyToGameId,
} from "../js/core/playerContribution.js";

const UID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("detectPlayerContribution (I-08)", () => {
  it("détecte un vote Hot Take uid-only", () => {
    const hit = detectPlayerContribution(
      { hotTake: { votes: { [UID]: "agree" } } },
      UID
    );
    assert.deepEqual(hit, { game: "hottake", kind: "vote", value: "agree" });
  });

  it("détecte ready prep", () => {
    const hit = detectPlayerContribution(
      { dilemma: { ready: { [UID]: true } } },
      UID
    );
    assert.deepEqual(hit, { game: "dilemma", kind: "ready", value: true });
  });

  it("détecte answer trivia", () => {
    const value = { answerIndex: 2, answeredAt: 123 };
    const hit = detectPlayerContribution(
      { trivia: { answers: { [UID]: value } } },
      UID
    );
    assert.deepEqual(hit, { game: "trivia", kind: "answer", value });
  });

  it("détecte tap / deal_ack / submission / placement / finished", () => {
    assert.equal(
      detectPlayerContribution({ clutch: { taps: { [UID]: { ms: 1 } } } }, UID).kind,
      "tap"
    );
    assert.equal(
      detectPlayerContribution({ traitre: { dealAcks: { [UID]: true } } }, UID).kind,
      "deal_ack"
    );
    assert.equal(
      detectPlayerContribution(
        { guessLie: { submissions: { [UID]: { truths: [] } } } },
        UID
      ).kind,
      "submission"
    );
    assert.equal(
      detectPlayerContribution(
        { tierNight: { placements: { [UID]: { S: [] } } } },
        UID
      ).kind,
      "placement"
    );
    assert.equal(
      detectPlayerContribution({ tierNight: { finished: { [UID]: true } } }, UID)
        .kind,
      "finished"
    );
  });

  it("refuse une clé UID étrangère", () => {
    assert.equal(
      detectPlayerContribution({ hotTake: { votes: { [OTHER]: "x" } } }, UID),
      null
    );
  });

  it("refuse un blob multi-maps (customs / play)", () => {
    assert.equal(
      detectPlayerContribution(
        { hotTake: { votes: { [UID]: "a" }, phase: "reveal" } },
        UID
      ),
      null
    );
  });

  it("refuse multi top-level keys", () => {
    assert.equal(
      detectPlayerContribution(
        { hotTake: { votes: { [UID]: 1 } }, scores: {} },
        UID
      ),
      null
    );
  });

  it("map stateKey → game id", () => {
    assert.equal(stateKeyToGameId("hotTake"), "hottake");
    assert.equal(stateKeyToGameId("tierNightLive"), "tiernightlive");
    assert.equal(stateKeyToGameId("unknown"), null);
  });
});
