import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldFullRenderWrongAnswer,
  wrongAnswerComposeStatusText,
  wrongAnswerVoteStatusText,
  wrongAnswerConfirmVoteState,
  wrongAnswerAuthorNames,
} from "../js/core/wrongAnswerUiRefresh.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = () => readFileSync(join(root, "js/games/wrongAnswer.js"), "utf8");

describe("BUG-WAO-02/03 — shouldFullRenderWrongAnswer", () => {
  it("1. même phase answer + answers-only → pas de full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "answer",
        phase: "answer",
        prevRound: 0,
        roundIdx: 0,
      }),
      false
    );
  });

  it("2. même phase voting → pas de full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "voting",
        phase: "voting",
        prevRound: 1,
        roundIdx: 1,
      }),
      false
    );
  });

  it("8. réponse → vote → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "answer",
        phase: "voting",
        prevRound: 0,
        roundIdx: 0,
      }),
      true
    );
  });

  it("9. nouveau roundIdx → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "reveal",
        phase: "answer",
        prevRound: 0,
        roundIdx: 1,
      }),
      true
    );
  });

  it("vote → reveal → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "voting",
        phase: "reveal",
        prevRound: 0,
        roundIdx: 0,
      }),
      true
    );
  });

  it("compose layout mismatch (form → feedback) → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "answer",
        phase: "answer",
        prevRound: 0,
        roundIdx: 0,
        composeLayoutMismatch: true,
      }),
      true
    );
  });

  it("vote list authors changed → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "voting",
        phase: "voting",
        prevRound: 0,
        roundIdx: 0,
        voteListAuthorsChanged: true,
      }),
      true
    );
  });
});

describe("BUG-WAO-02 — textes chrome composition", () => {
  it("en rédaction : message secret", () => {
    assert.match(
      wrongAnswerComposeStatusText({
        submitted: false,
        mp: true,
        allIn: false,
        answeredCount: 0,
        total: 3,
      }),
      /pire réponse/
    );
  });

  it("soumis MP : compteur X/Y", () => {
    assert.equal(
      wrongAnswerComposeStatusText({
        submitted: true,
        mp: true,
        allIn: false,
        answeredCount: 1,
        total: 3,
      }),
      "Réponse envoyée - en attente des autres (1/3)…"
    );
  });

  it("draft non compté dans le contrat status (seulement answeredCount passé)", () => {
    // Le helper reçoit answeredCount déjà fondé sur answers confirmées.
    assert.equal(
      wrongAnswerComposeStatusText({
        submitted: true,
        mp: true,
        allIn: false,
        answeredCount: 2,
        total: 3,
      }),
      "Réponse envoyée - en attente des autres (2/3)…"
    );
  });
});

describe("BUG-WAO-03 — textes chrome vote", () => {
  it("compteur votes + confirm state", () => {
    assert.match(
      wrongAnswerVoteStatusText({
        voted: true,
        allIn: false,
        votedCount: 2,
        total: 4,
      }),
      /2\/4/
    );
    const st = wrongAnswerConfirmVoteState({
      displayPick: "Bob",
      localName: "Alice",
      voted: false,
    });
    assert.equal(st.confirmDisabled, false);
    assert.equal(st.label, "Valider mon vote");
  });

  it("auteurs stables triés", () => {
    assert.deepEqual(
      wrongAnswerAuthorNames({
        Bob: { text: "x" },
        Alice: { text: "y" },
        Zoe: {},
      }),
      ["Alice", "Bob"]
    );
  });
});

describe("BUG-WAO-02/03 — wiring wrongAnswer.js", () => {
  it("expose refresh ciblés et ne full-render pas systématiquement au sync", () => {
    const src = gameSrc();
    assert.match(src, /function refreshWrongAnswerResponseProgress/);
    assert.match(src, /function refreshWrongAnswerVoteProgress/);
    assert.match(src, /shouldFullRenderWrongAnswer/);
    assert.match(src, /id="wrong-input"/);
    assert.match(src, /id="wrong-vote-list"/);
    assert.match(src, /id="wrong-answer-status"/);
    assert.match(src, /id="wrong-vote-status"/);
    // Sélection locale vote : refresh ciblé, pas render()
    assert.match(
      src,
      /selectedTarget = target;\s*[\s\S]*?refreshWrongAnswerVoteProgress\(\)/
    );
  });

  it("ne force pas focus\(\) sur le textarea après sync distant", () => {
    const src = gameSrc();
    assert.equal(/#wrong-input[\s\S]{0,80}\.focus\(/.test(src), false);
    assert.equal(/wrong-input"\)\.focus/.test(src), false);
  });
});
