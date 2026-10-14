import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  consensusRecoveryBannerCopy,
  shouldContinueConsensusRevealAfterRecovery,
} from "../js/games/consensus.js";
import { renderConsensusQuestion } from "../js/consensus/ConsensusQuestion.js";

const ready = {
  writesBlocked: false,
  phase: "question",
  allAnswersIn: true,
  canLeadReveal: true,
  revealInFlight: false,
  revealPendingInFlight: false,
  revealPendingScheduled: false,
};

describe("consensus recovery banner copy", () => {
  it("answer nomme l'envoi de la réponse", () => {
    const copy = consensusRecoveryBannerCopy("answer");
    assert.equal(copy.hint, "L'envoi de ta réponse n'est pas confirmé.");
    assert.equal(copy.button, "Réessayer d'envoyer ma réponse");
  });

  it("next-question nomme le passage à la question suivante", () => {
    const copy = consensusRecoveryBannerCopy("next-question");
    assert.equal(copy.hint, "Le passage à la question suivante n'est pas confirmé.");
    assert.equal(copy.button, "Réessayer de passer à la question suivante");
  });

  it("reveal ne promet pas de relancer la révélation", () => {
    const copy = consensusRecoveryBannerCopy("reveal");
    assert.equal(
      copy.hint,
      "Cette action n'est pas relancée depuis ce téléphone. L'écran peut afficher la partie."
    );
    assert.equal(copy.button, "Voir la partie");
    assert.equal(copy.button.includes("Réessayer"), false);
  });

  it("play ne promet pas de relancer l'action", () => {
    const copy = consensusRecoveryBannerCopy("play");
    assert.equal(copy.hint, consensusRecoveryBannerCopy("reveal").hint);
    assert.equal(copy.button, "Voir la partie");
  });

  it("le clic reste sur rereadSharedConsensus et le poll ne gagne pas ce rattrapage", () => {
    const src = fs.readFileSync(new URL("../js/games/consensus.js", import.meta.url), "utf8");
    const clickAt = src.indexOf('"#btn-consensus-recheck"');
    const click = src.slice(clickAt, src.indexOf("const newScrollEl", clickAt));
    assert.match(click, /rereadSharedConsensus\(\)/);
    assert.equal(click.includes("resumeConsensusAnswer"), false);
    assert.equal(click.includes("resumeConsensusNextQuestion"), false);
    const rereadAt = src.indexOf("async function rereadSharedConsensus");
    const reread = src.slice(rereadAt, src.indexOf("async function beginReveal"));
    assert.match(reread, /shouldContinueConsensusRevealAfterRecovery/);
    assert.match(reread, /await beginReveal\(\)/);
    assert.equal(reread.includes("resumeConsensusAnswer"), true);
    assert.equal(reread.includes("resumeConsensusNextQuestion"), true);
    const pollAt = src.indexOf("const unsub = onGameSessionChange");
    const poll = src.slice(pollAt, src.indexOf("render();\n  lastAckedActingHostToken", pollAt));
    assert.equal(poll.includes("shouldContinueConsensusRevealAfterRecovery"), false);
    assert.equal(poll.includes("rereadSharedConsensus"), false);
    assert.equal(poll.includes("resumeConsensusAnswer"), false);
    assert.equal(poll.includes("resumeConsensusNextQuestion"), false);
    const hostSrc = fs.readFileSync(new URL("../js/core/hostPresence.js", import.meta.url), "utf8");
    assert.match(hostSrc, /export function resolveActingHostUserId/);
    assert.match(hostSrc, /\.sort\(\(a, b\) => String\(a\)\.localeCompare\(String\(b\)\)\)/);
    const life = fs.readFileSync(new URL("../js/config/lobbyLifecycle.js", import.meta.url), "utf8");
    assert.match(life, /HOST_PRESENCE_STALE_MS = 120 \* 1000/);
  });
});

function questionHtml(step, blockedMessage) {
  return renderConsensusQuestion({
    question: { id: "q", question: "Test" },
    questionIdx: 0,
    totalQuestions: 5,
    interactionBlocked: true,
    blockedMessage,
    waitingMessage: "Choisis une valeur entre 0 et 100 puis valide.",
  });
}

describe("message du curseur selon l'étape", () => {
  function bothSpots(html, hint) {
    assert.match(html, new RegExp(`consensus-slider__sub">${hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(html, new RegExp(`truth-meter__hint">${hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(html.includes("Tu ne peux plus l'envoyer depuis ce téléphone"), false);
    assert.equal(html.includes("n'est pas partie"), false);
  }

  it("answer et next-question reprennent l'indice du bandeau aux deux endroits", () => {
    for (const step of ["answer", "next-question"]) {
      const hint = consensusRecoveryBannerCopy(step).hint;
      bothSpots(questionHtml(step, hint), hint);
    }
  });

  it("reveal et play n'affichent pas un libellé de réponse", () => {
    for (const step of ["reveal", "play"]) {
      const hint = consensusRecoveryBannerCopy(step).hint;
      const html = questionHtml(step, hint);
      bothSpots(html, hint);
      assert.equal(hint.includes("réponse"), false);
      assert.equal(html.includes("L'envoi de ta réponse"), false);
      assert.equal(html.includes("Réessayer d'envoyer ma réponse"), false);
      assert.equal(html.includes("Le passage à la question suivante"), false);
    }
  });

  it("sans blockedMessage, la copie de secours n'affirme ni un échec ni un blocage définitif", () => {
    const html = renderConsensusQuestion({
      question: { id: "q", question: "Test" },
      interactionBlocked: true,
    });
    bothSpots(html, "Cette action n'est pas confirmée.");
    assert.equal(html.includes("Tu ne peux plus"), false);
  });
});

describe("révélation après reprise d'une réponse", () => {
  it("démarre quand la réponse récupérée complète la manche", () => {
    assert.equal(shouldContinueConsensusRevealAfterRecovery(ready), true);
  });

  it("ne démarre pas si une réponse manque, si la phase a changé ou si le téléphone ne mène pas", () => {
    assert.equal(shouldContinueConsensusRevealAfterRecovery({ ...ready, allAnswersIn: false }), false);
    assert.equal(shouldContinueConsensusRevealAfterRecovery({ ...ready, phase: "reveal" }), false);
    assert.equal(shouldContinueConsensusRevealAfterRecovery({ ...ready, phase: "reveal-pending" }), false);
    assert.equal(shouldContinueConsensusRevealAfterRecovery({ ...ready, canLeadReveal: false }), false);
  });

  it("ne démarre pas si une révélation est déjà en cours", () => {
    assert.equal(shouldContinueConsensusRevealAfterRecovery({ ...ready, revealInFlight: true }), false);
    assert.equal(
      shouldContinueConsensusRevealAfterRecovery({ ...ready, revealPendingInFlight: true }),
      false
    );
    assert.equal(
      shouldContinueConsensusRevealAfterRecovery({ ...ready, revealPendingScheduled: true }),
      false
    );
  });

  it("ne démarre pas tant qu'un marqueur bloque encore", () => {
    assert.equal(shouldContinueConsensusRevealAfterRecovery({ ...ready, writesBlocked: true }), false);
  });
});
