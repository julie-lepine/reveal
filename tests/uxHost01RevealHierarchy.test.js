/**
 * UX-HOST-01 - hiérarchie mid-round : reveal → action → cumul.
 *
 * Preuve = contrats source sur les templates reveal (pas d’import des mounts
 * monolithes gameSync/lobby). Les listeners restent attachés par ID après
 * innerHTML - vérifié ici par présence inchangée des sélecteurs #id.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Extrait un bloc source entre deux marqueurs ; assert ordre d’ancres.
 * @param {string} body
 * @param {{ action: RegExp, cumul: RegExp, manche?: RegExp }} anchors
 */
function assertRevealHierarchy(body, anchors, label) {
  const actionIdx = body.search(anchors.action);
  const cumulIdx = body.search(anchors.cumul);
  assert.ok(actionIdx >= 0, `${label}: ancre action introuvable`);
  assert.ok(cumulIdx >= 0, `${label}: ancre cumul introuvable`);
  assert.ok(
    actionIdx < cumulIdx,
    `${label}: action (idx ${actionIdx}) doit précéder cumul (idx ${cumulIdx})`
  );
  if (anchors.manche) {
    const mancheIdx = body.search(anchors.manche);
    assert.ok(mancheIdx >= 0, `${label}: ancre résultat de manche introuvable`);
    assert.ok(
      mancheIdx < actionIdx,
      `${label}: résultat de manche doit précéder l’action`
    );
  }
}

describe("UX-HOST-01 - hiérarchie reveal mid-round", () => {
  it("Trivia reveal : bonne réponse → CTA → classement live", () => {
    const file = src("js/games/trivia.js");
    const start = file.indexOf('} else if (phase === "reveal")');
    const end = file.indexOf("} else {", start);
    const body = file.slice(start, end);
    assertRevealHierarchy(
      body,
      {
        manche: /revealBlock\(\)/,
        action: /id="btn-trivia-next"/,
        cumul: /renderTriviaScoreboard\(/,
      },
      "Trivia"
    );
    assert.match(body, /reveal-mid-action/);
    assert.match(body, /En attente de l'hote pour la suite/);
    assert.match(file, /#btn-trivia-next/);
  });

  it("Consensus reveal : résultats → CTA → classement", () => {
    const file = src("js/games/consensus.js");
    const start = file.indexOf('} else if (phase === "reveal")');
    const end = file.indexOf("} else {", start);
    const body = file.slice(start, end);
    assertRevealHierarchy(
      body,
      {
        manche: /renderConsensusResults\(/,
        action: /id="btn-consensus-next"/,
        cumul: /renderConsensusScoreboard\(/,
      },
      "Consensus"
    );
    assert.match(file, /#btn-consensus-next/);
  });

  it("Hot Take reveal : votes → CTA → cumul", () => {
    const file = src("js/games/hotTake.js");
    const start = file.indexOf('if (phase === "reveal")');
    const end = file.indexOf('if (phase === "final")', start);
    const body = file.slice(start, end);
    assertRevealHierarchy(
      body,
      {
        manche: /hotTakePlayerVotesHtml\(/,
        action: /id="next-take"/,
        cumul: /gameCumulativeScoresHtml\(/,
      },
      "Hot Take"
    );
    assert.match(file, /#next-take/);
  });

  it("Clutch : rank manche → CTA → cumul (exception)", () => {
    const file = src("js/games/clutch.js");
    const start = file.indexOf("function revealHtml()");
    const end = file.indexOf("function render()", start);
    const body = file.slice(start, end);
    assertRevealHierarchy(
      body,
      {
        manche: /clutch-rank/,
        action: /id="next-round"/,
        cumul: /gameCumulativeScoresHtml\(/,
      },
      "Clutch"
    );
    assert.match(file, /#next-round/);
  });

  it("Wrong Answer : verdict list → CTA → cumul", () => {
    const file = src("js/games/wrongAnswer.js");
    const start = file.indexOf("wrong-reveal-list");
    const end = file.indexOf("BUG-WAO-02", start);
    const body = file.slice(start, end > start ? end : start + 1200);
    assertRevealHierarchy(
      body,
      {
        manche: /wrong-reveal-list/,
        action: /id="next-round"/,
        cumul: /gameCumulativeScoresHtml\(/,
      },
      "Wrong Answer"
    );
  });

  it("Dilemma : bars + votes → CTA → cumul", () => {
    const file = src("js/games/dilemma.js");
    const start = file.indexOf('<h3 class="section-title">Résultats</h3>');
    const end = file.indexOf("function countPlayersVoted", start);
    const body = file.slice(start, end);
    assertRevealHierarchy(
      body,
      {
        manche: /dilemma__result-row/,
        action: /id="next-round"/,
        cumul: /gameCumulativeScoresHtml\(/,
      },
      "Dilemma"
    );
    // Cumul ne doit plus être avant les barres
    const cumulIdx = body.search(/gameCumulativeScoresHtml\(/);
    const barsIdx = body.search(/dilemma__result-row/);
    assert.ok(barsIdx < cumulIdx);
  });

  it("SpeedVote : award + bars + votes → CTA → cumul", () => {
    const file = src("js/games/speedVote.js");
    const start = file.indexOf('<h3 class="section-title">Résultats du vote</h3>');
    const end = file.indexOf("function render()", start);
    const body = file.slice(start, end);
    assertRevealHierarchy(
      body,
      {
        manche: /awardHtml/,
        action: /id="next-round"/,
        cumul: /gameCumulativeScoresHtml\(/,
      },
      "SpeedVote"
    );
  });

  it("TruthMeter : gauge/spread → CTA → cumul", () => {
    const file = src("js/games/truthMeter.js");
    const start = file.indexOf("spreadHtml(votesToShow");
    const end = file.indexOf("app.innerHTML = pageShell", start);
    const body = file.slice(start, end);
    assertRevealHierarchy(
      body,
      {
        manche: /spreadHtml/,
        action: /id="next-round"/,
        cumul: /gameCumulativeScoresHtml\(/,
      },
      "TruthMeter"
    );
  });

  it("Guess Lie : storytelling + votes → CTA → cumul", () => {
    const file = src("js/games/guessLie.js");
    const start = file.indexOf('<h3 class="section-title">Révélation</h3>');
    const end = file.indexOf("app.innerHTML = pageShell", start);
    const body = file.slice(start, end);
    assertRevealHierarchy(
      body,
      {
        manche: /statement--lie|card--feedback/,
        action: /id="next-round"/,
        cumul: /gameCumulativeScoresHtml\(/,
      },
      "Guess Lie"
    );
    const votesIdx = body.search(/card--votes/);
    const actionIdx = body.search(/id="next-round"/);
    assert.ok(votesIdx >= 0 && votesIdx < actionIdx, "votes storytelling avant CTA");
  });

  it("Tier Night Live : déjà reveal → CTA, sans cumul box", () => {
    const file = src("js/games/tierNightLive.js");
    const start = file.indexOf("function revealPhaseHtml()");
    const end = file.indexOf("function render()", start);
    const body = file.slice(start, end);
    assert.match(body, /consensusRevealHtml/);
    assert.match(body, /id="live-next"/);
    assert.equal(body.includes("gameCumulativeScoresHtml"), false);
    const revealIdx = body.search(/consensusRevealHtml/);
    const actionIdx = body.search(/id="live-next"/);
    assert.ok(revealIdx < actionIdx);
  });

  it("IDs CTA inchangés + listeners querySelector conservés", () => {
    const checks = [
      ["js/games/trivia.js", "btn-trivia-next"],
      ["js/games/consensus.js", "btn-consensus-next"],
      ["js/games/hotTake.js", "next-take"],
      ["js/games/clutch.js", "next-round"],
      ["js/games/wrongAnswer.js", "next-round"],
      ["js/games/dilemma.js", "next-round"],
      ["js/games/speedVote.js", "next-round"],
      ["js/games/truthMeter.js", "next-round"],
      ["js/games/guessLie.js", "next-round"],
    ];
    for (const [rel, id] of checks) {
      const file = src(rel);
      assert.match(file, new RegExp(`id="${id}"`));
      assert.match(file, new RegExp(`#${id}`));
      assert.doesNotMatch(
        file,
        /previousSibling|nextElementSibling|lastElementChild/
      );
    }
  });

  it("CSS séparation discrète reveal-mid-action (pas sticky)", () => {
    const css = src("style.css");
    assert.match(css, /\.reveal-mid-action\s*\{/);
    assert.doesNotMatch(css, /position:\s*sticky/);
    assert.doesNotMatch(css, /reveal-mid-action[\s\S]{0,80}fixed/);
  });
});
