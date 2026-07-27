/**
 * Guess Lie — diagnostic identité fantôme (couches submissions / rounds).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeGuessLieGhostLayers,
  buildGuessLieRoundsFromSources,
  shouldLogGuessLieGhostDiagnostic,
} from "../js/core/guessLieGhostDiagnostic.js";

const valid = (tag) => ({
  statements: [`${tag}a`, `${tag}b`, `${tag}c`],
  lie: 0,
});

describe("buildGuessLieRoundsFromSources", () => {
  it("clé submissions hors roster produit une manche fantôme", () => {
    const subs = {
      Alice: valid("A"),
      OldPseudo: valid("O"),
    };
    const rounds = buildGuessLieRoundsFromSources(subs, ["Alice", "Bob"]);
    assert.equal(rounds.length, 2);
    assert.deepEqual(
      rounds.map((r) => r.player),
      ["Alice", "OldPseudo"]
    );
  });
});

describe("analyzeGuessLieGhostLayers", () => {
  const uidAlice = "uid-alice";
  const uidMap = { Alice: uidAlice, OldPseudo: uidAlice, Toi: uidAlice };

  it("firstGhostLayer = remote quand soumission stale distante hors roster", () => {
    const analysis = analyzeGuessLieGhostLayers({
      lobbyMemberNames: ["Alice", "Bob"],
      localSubmissions: { Alice: valid("A") },
      remoteSubmissionsByName: {
        Alice: valid("A"),
        OldPseudo: valid("O"),
      },
      localUid: uidAlice,
      localDisplayName: "Alice",
      localLobbyParticipantName: "Alice",
      userIdForName: (n) => uidMap[n] || null,
    });
    assert.ok(analysis.keysNotInLobbyRoster.includes("OldPseudo"));
    assert.ok(analysis.triggers.submissionKeyNotInRoster);
    assert.equal(
      analysis.firstGhostLayer,
      "game_sessions.state.guessLie.submissions (remote)"
    );
  });

  it("firstGhostLayer = local quand clé locale stale hors roster", () => {
    const analysis = analyzeGuessLieGhostLayers({
      lobbyMemberNames: ["Alice"],
      localSubmissions: { Alice: valid("A"), Toi: valid("T") },
      remoteSubmissionsByName: { Alice: valid("A") },
      localUid: uidAlice,
      localDisplayName: "Alice",
      localLobbyParticipantName: "Alice",
      userIdForName: (n) => uidMap[n] || null,
    });
    assert.ok(analysis.localOnlyValidKeys.includes("Toi"));
    assert.equal(analysis.firstGhostLayer, "state.guessLie.submissions (local)");
  });

  it("roundPlayersNotInRoster sans lobby_members fantôme", () => {
    const analysis = analyzeGuessLieGhostLayers({
      lobbyMemberNames: ["Alice", "Bob"],
      localSubmissions: { OldPseudo: valid("O"), Alice: valid("A"), Bob: valid("B") },
      remoteSubmissionsByName: {},
      localUid: uidAlice,
      localDisplayName: "Alice",
      userIdForName: (n) => (n === "Alice" ? uidAlice : n === "Bob" ? "uid-bob" : null),
    });
    assert.deepEqual(analysis.roundPlayersNotInRoster, ["OldPseudo"]);
    assert.ok(analysis.triggers.roundPlayerNotInRoster);
  });
});

describe("shouldLogGuessLieGhostDiagnostic", () => {
  it("déclenche sur clé hors roster même sans match UID round", () => {
    const analysis = analyzeGuessLieGhostLayers({
      lobbyMemberNames: ["Alice"],
      localSubmissions: { Ghost: valid("G") },
      remoteSubmissionsByName: {},
      localUid: "uid-alice",
      localDisplayName: "Alice",
      userIdForName: () => null,
    });
    assert.equal(
      shouldLogGuessLieGhostDiagnostic(analysis, {
        isSubject: false,
        roundPlayer: "Ghost",
        localUid: "uid-alice",
      }),
      true
    );
  });
});
