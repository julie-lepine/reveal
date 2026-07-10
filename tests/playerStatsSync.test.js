import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getState, saveStatePatch } from "../js/core/state.js";
import {
  playerStatsToRemote,
  applyRemotePlayerStats,
} from "../js/core/playerStatsSync.js";
import { buildBadgeMap } from "../js/core/badgeRules.js";

const LOBBY = {
  id: "lobby-test",
  code: "TEST",
  participants: [
    { name: "Alice", userId: "uid-alice", color: "#f00", emoji: "A", isLocal: false },
    { name: "Bob", userId: "uid-bob", color: "#0f0", emoji: "B", isLocal: true },
  ],
};

const nameToUid = (name) => (name === "Alice" ? "uid-alice" : name === "Bob" ? "uid-bob" : null);
const uidToName = (uid) =>
  uid === "uid-alice" ? "Alice" : uid === "uid-bob" ? "Bob" : null;

describe("playerStats sync MP", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    saveStatePatch({
      inLobby: true,
      lobby: LOBBY,
      playerStats: {
        Alice: { liesDetected: 3, hotTakeDissentWins: 2 },
        Bob: { liesFooled: 2 },
      },
    });
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("sérialise les stats par userId pour la session", () => {
    const remote = playerStatsToRemote(getState().playerStats, nameToUid);
    assert.equal(remote["uid-alice"].liesDetected, 3);
    assert.equal(remote["uid-alice"].hotTakeDissentWins, 2);
    assert.equal(remote["uid-bob"].liesFooled, 2);
  });

  it("fusionne par max (invité en retard)", () => {
    saveStatePatch({
      playerStats: {
        Alice: { liesDetected: 1 },
        Bob: { liesFooled: 5 },
      },
    });
    applyRemotePlayerStats(
      {
        "uid-alice": { liesDetected: 3, hotTakeDissentWins: 2 },
        "uid-bob": { liesFooled: 2 },
      },
      uidToName
    );
    const { playerStats } = getState();
    assert.equal(playerStats.Alice.liesDetected, 3);
    assert.equal(playerStats.Alice.hotTakeDissentWins, 2);
    assert.equal(playerStats.Bob.liesFooled, 5);
  });

  it("produit les mêmes badges après sync invité", () => {
    const hostStats = structuredClone(getState().playerStats);
    saveStatePatch({ playerStats: {} });
    applyRemotePlayerStats(playerStatsToRemote(hostStats, nameToUid), uidToName);
    const badges = buildBadgeMap(getState().playerStats, ["Alice", "Bob"]);
    assert.equal(badges.Alice, "Le détective");
    assert.equal(badges.Bob, "L'imposteur");
  });

  it("n'envoie pas de cle pseudo quand le joueur n'a pas d'uid", () => {
    const remote = playerStatsToRemote(
      {
        Alice: { liesDetected: 3 },
        Ghost: { liesDetected: 99 },
      },
      nameToUid
    );

    assert.deepEqual(remote, { "uid-alice": { liesDetected: 3 } });
  });

});
