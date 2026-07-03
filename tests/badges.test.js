import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBadgeMap } from "../js/core/badgeRules.js";

describe("buildBadgeMap", () => {
  it("attribue chaque badge au meilleur score de la règle", () => {
    const stats = {
      Alice: { liesDetected: 3 },
      Bob: { liesFooled: 2 },
      Claire: { tierConsensusPoints: 8 },
    };
    const map = buildBadgeMap(stats, ["Alice", "Bob", "Claire"]);
    assert.equal(map.Alice, "Le détective");
    assert.equal(map.Bob, "L'imposteur");
    assert.equal(map.Claire, "Esprit consensus");
  });

  it("ex æquo : gagnant déterministe (ordre alphabétique)", () => {
    const stats = {
      Alice: { liesDetected: 5 },
      Bob: { liesDetected: 5 },
    };
    const map = buildBadgeMap(stats, ["Alice", "Bob"]);
    assert.equal(map.Alice, "Le détective");
    assert.equal(map.Bob, undefined);
  });

  it("est déterministe quel que soit l'ordre des noms", () => {
    const stats = {
      Alice: { liesDetected: 5 },
      Bob: { liesDetected: 5 },
    };
    const a = buildBadgeMap(stats, ["Alice", "Bob"]);
    const b = buildBadgeMap(stats, ["Bob", "Alice"]);
    assert.deepEqual(a, b);
    assert.equal(a.Alice, "Le détective");
  });

  it("n'attribue pas de badge si aucun score positif", () => {
    const map = buildBadgeMap({ Alice: {}, Bob: {} }, ["Alice", "Bob"]);
    assert.deepEqual(map, {});
  });
});
