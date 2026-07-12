import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatSyncErrorMessage, isSyncNetworkError } from "../js/core/authErrors.js";

describe("formatSyncErrorMessage", () => {
  it("remplace les erreurs réseau fetch par un message lisible", () => {
    assert.equal(
      formatSyncErrorMessage("TypeError: Failed to fetch"),
      "Connexion impossible. Vérifie ton réseau et réessaie."
    );
    assert.equal(
      formatSyncErrorMessage("NetworkError when attempting to fetch resource."),
      "Connexion impossible. Vérifie ton réseau et réessaie."
    );
  });

  it("conserve les messages déjà en français", () => {
    assert.equal(
      formatSyncErrorMessage("Synchronisation trop longue."),
      "Synchronisation trop longue."
    );
    assert.equal(
      formatSyncErrorMessage("Impossible de synchroniser la partie (session introuvable)."),
      "Impossible de synchroniser la partie (session introuvable)."
    );
  });

  it("utilise le fallback si le message est vide", () => {
    assert.equal(formatSyncErrorMessage(""), "Impossible de synchroniser.");
    assert.equal(formatSyncErrorMessage(null), "Impossible de synchroniser.");
  });
});

describe("isSyncNetworkError", () => {
  it("détecte les erreurs fetch / réseau", () => {
    assert.equal(isSyncNetworkError("TypeError: Failed to fetch"), true);
    assert.equal(isSyncNetworkError("NetworkError when attempting to fetch resource."), true);
  });

  it("ignore les autres messages", () => {
    assert.equal(isSyncNetworkError("Impossible de lancer Hot Take."), false);
    assert.equal(isSyncNetworkError("Synchronisation trop longue."), false);
  });
});
