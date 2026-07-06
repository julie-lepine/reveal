import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { voteConfirmChrome, pickForVoteConfirm } from "../js/core/voteConfirm.js";

describe("pickForVoteConfirm", () => {
  it("prend le choix local en cours plutôt que le vote commité", () => {
    assert.equal(pickForVoteConfirm("Criminel", "Valide"), "Criminel");
    assert.equal(pickForVoteConfirm("B", "A"), "B");
  });

  it("retombe sur le vote commité si aucune sélection locale", () => {
    assert.equal(pickForVoteConfirm(null, "Valide"), "Valide");
    assert.equal(pickForVoteConfirm(undefined, "A"), "A");
  });
});

describe("voteConfirmChrome", () => {
  it("active le bouton quand le joueur change d'avis avant validation", () => {
    const ui = voteConfirmChrome({ selected: "B", committed: "A", allIn: false });
    assert.equal(ui.displayPick, "B");
    assert.equal(ui.hasPendingChange, true);
    assert.equal(ui.confirmDisabled, false);
    assert.equal(ui.confirmLabel, "Valider mon vote");
    assert.match(ui.hint, /modifier ton vote/i);
  });

  it("désactive le bouton après validation tant que la manche continue", () => {
    const ui = voteConfirmChrome({ selected: null, committed: "A", allIn: false });
    assert.equal(ui.confirmDisabled, true);
    assert.equal(ui.confirmLabel, "En attente des autres joueurs…");
  });
});
