import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyGuessLieIdentityCase } from "../js/core/guessLieIdentityCase.js";

describe("classifyGuessLieIdentityCase", () => {
  const localUid = "uid-local";

  it("Cas A : une seule clé valide pour l'UID local", () => {
    const keys = [
      { key: "Fox", uid: localUid, valid: true },
      { key: "Host", uid: "uid-host", valid: true },
    ];
    assert.equal(classifyGuessLieIdentityCase(keys, localUid), "A");
  });

  it("Cas B : deux clés valides pour le même UID local", () => {
    const keys = [
      { key: "Fox", uid: localUid, valid: true },
      { key: "Toi", uid: localUid, valid: true },
      { key: "Host", uid: "uid-host", valid: true },
    ];
    assert.equal(classifyGuessLieIdentityCase(keys, localUid), "B");
  });

  it("unknown si aucune clé ne résout vers l'UID local", () => {
    const keys = [{ key: "Fox", uid: "other", valid: true }];
    assert.equal(classifyGuessLieIdentityCase(keys, localUid), "unknown");
  });
});
