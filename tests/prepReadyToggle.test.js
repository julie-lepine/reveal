import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePrepReadyToggle } from "../js/core/prepReadyMaps.js";

describe("computePrepReadyToggle", () => {
  it("bascule une clé ready sans effacer les autres", () => {
    const session = { ready: { Alice: false, Bob: true } };
    const { previousReady, nextReady } = computePrepReadyToggle(session, "ready", "Alice", true);
    assert.deepEqual(previousReady, { Alice: false, Bob: true });
    assert.deepEqual(nextReady, { Alice: true, Bob: true });
  });

  it("permet un rollback vers l'état précédent", () => {
    const session = { ready: { Alice: false } };
    const { previousReady, nextReady } = computePrepReadyToggle(session, "ready", "Alice", true);
    assert.deepEqual(nextReady, { Alice: true });
    assert.deepEqual(previousReady, { Alice: false });
  });

  it("supporte un champ ready personnalisé", () => {
    const session = { prepReady: { u1: false } };
    const { previousReady, nextReady } = computePrepReadyToggle(session, "prepReady", "u1", true);
    assert.deepEqual(previousReady, { u1: false });
    assert.deepEqual(nextReady, { u1: true });
  });
});
