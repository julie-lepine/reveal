import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchRoster } from "../js/core/prepRoster.js";

describe("buildLaunchRoster", () => {
  const participants = [
    { name: "Alice", isHost: true },
    { name: "Bob", isHost: false },
    { name: "Carol", isHost: false },
    { name: "Dave", isHost: false },
  ];

  it("inclut l'hôte même s'il n'est pas prêt", () => {
    const readyMap = { Bob: true, Carol: true };
    const { roster, excluded } = buildLaunchRoster(participants, readyMap);
    assert.deepEqual(roster.sort(), ["Alice", "Bob", "Carol"]);
    assert.deepEqual(excluded, ["Dave"]);
  });

  it("roster = tous quand tout le monde est prêt", () => {
    const readyMap = { Alice: true, Bob: true, Carol: true, Dave: true };
    const { roster, excluded } = buildLaunchRoster(participants, readyMap);
    assert.equal(roster.length, 4);
    assert.deepEqual(excluded, []);
  });

  it("supporte readyKey personnalisé (userId)", () => {
    const byId = [
      { name: "Alice", userId: "u1", isHost: true },
      { name: "Bob", userId: "u2", isHost: false },
    ];
    const { roster } = buildLaunchRoster(byId, { u2: true }, { readyKey: (p) => p.userId });
    assert.deepEqual(roster.sort(), ["Alice", "Bob"]);
  });
});
