import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVENING_STANDING_FALLBACK,
  nameHasEveningContribution,
  collectEveningContributorNames,
  buildEveningStandingPlayers,
} from "../js/core/eveningStandings.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function namesOf(players) {
  return players.map((p) => p.name).sort();
}

describe("UX-HIST-01 - contribution soirée", () => {
  it("scores !== 0 (positif) compte comme contribution", () => {
    assert.equal(
      nameHasEveningContribution("Alice", { scores: { Alice: 12 }, gameScores: {} }),
      true
    );
  });

  it("score négatif compte comme contribution", () => {
    assert.equal(
      nameHasEveningContribution("Alice", { scores: { Alice: -3 }, gameScores: {} }),
      true
    );
  });

  it("scores === 0 seul (ensurePlayerScore) n’est PAS une contribution", () => {
    assert.equal(
      nameHasEveningContribution("Alice", { scores: { Alice: 0 }, gameScores: {} }),
      false
    );
  });

  it("clé gameScores avec 0 prouve une participation créditée", () => {
    assert.equal(
      nameHasEveningContribution("Alice", {
        scores: { Alice: 0 },
        gameScores: { clutch: { Alice: 0 } },
      }),
      true
    );
  });

  it("clé absente / non numérique → pas de contribution", () => {
    assert.equal(
      nameHasEveningContribution("Alice", {
        scores: {},
        gameScores: { clutch: { Bob: 5 } },
      }),
      false
    );
    assert.equal(
      nameHasEveningContribution("Alice", {
        scores: { Alice: "0" },
        gameScores: { clutch: { Alice: null } },
      }),
      false
    );
  });

  it("filtre gameId : seule la map de ce jeu compte", () => {
    assert.equal(
      nameHasEveningContribution("Alice", {
        scores: { Alice: 50 },
        gameScores: { clutch: { Alice: 0 }, trivia: { Bob: 3 } },
        gameId: "trivia",
      }),
      false
    );
    assert.equal(
      nameHasEveningContribution("Alice", {
        scores: {},
        gameScores: { clutch: { Alice: 0 } },
        gameId: "clutch",
      }),
      true
    );
  });
});

describe("UX-HIST-01 - buildEveningStandingPlayers", () => {
  const bob = {
    name: "Bob",
    color: "#111",
    emoji: "🅱️",
    isLocal: true,
    isHost: true,
  };

  it("1. joueur actif sans points reste affiché", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Bob: 0 },
      gameScores: {},
    });
    assert.deepEqual(namesOf(players), ["Bob"]);
    assert.equal(players[0].historical, false);
    assert.equal(players[0].emoji, "🅱️");
  });

  it("2. joueur ayant marqué puis quitté reste avec son score (via maps)", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Bob: 10, Alice: 25 },
      gameScores: { clutch: { Alice: 25, Bob: 10 } },
    });
    assert.deepEqual(namesOf(players), ["Alice", "Bob"]);
    const alice = players.find((p) => p.name === "Alice");
    assert.equal(alice.historical, true);
  });

  it("3. joueur rejoint puis parti sans contribution n’apparaît pas", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Bob: 5, Ghost: 0 },
      gameScores: { clutch: { Bob: 5 } },
    });
    assert.deepEqual(namesOf(players), ["Bob"]);
  });

  it("4. zéro point crédité via gameScores est conservé (contrat documenté)", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Bob: 1, ZeroHero: 0 },
      gameScores: { trivia: { ZeroHero: 0, Bob: 1 } },
    });
    assert.ok(players.some((p) => p.name === "ZeroHero"));
  });

  it("4b. zéro point ensurePlayerScore seul (parti) est exclu", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Bob: 1, Visitor: 0 },
      gameScores: {},
    });
    assert.equal(
      players.some((p) => p.name === "Visitor"),
      false
    );
  });

  it("5. score négatif historique n’est pas perdu", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Bob: 2, Neg: -4 },
      gameScores: {},
    });
    assert.ok(players.some((p) => p.name === "Neg"));
  });

  it("6. rename Alice→Alicia→Alix puis parti : une seule ligne Alix", () => {
    // Après SYN-15/16 les maps ne portent plus Alice/Alicia - seulement Alix.
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Bob: 3, Alix: 40 },
      gameScores: { clutch: { Alix: 40, Bob: 3 } },
    });
    assert.deepEqual(namesOf(players), ["Alix", "Bob"]);
    assert.equal(players.some((p) => p.name === "Alice"), false);
    assert.equal(players.some((p) => p.name === "Alicia"), false);
  });

  it("7. autre joueur actif : métadonnées roster inchangées", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Bob: 7, Alice: 1 },
      gameScores: { clutch: { Alice: 1 } },
    });
    const b = players.find((p) => p.name === "Bob");
    assert.equal(b.color, "#111");
    assert.equal(b.emoji, "🅱️");
    assert.equal(b.isLocal, true);
    assert.equal(b.isHost, true);
    assert.equal(b.historical, false);
  });

  it("8. historique sans métadonnées roster → fallbacks sans exception", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [],
      scores: { Ghost: 9 },
      gameScores: {},
    });
    assert.equal(players.length, 1);
    assert.equal(players[0].emoji, EVENING_STANDING_FALLBACK.emoji);
    assert.equal(players[0].color, EVENING_STANDING_FALLBACK.color);
    assert.equal(players[0].historical, true);
    assert.equal(players[0].isLocal, false);
  });

  it("9. classements par jeu : contributeur seulement sur le jeu concerné", () => {
    const maps = {
      activePlayers: [bob],
      scores: { Bob: 10, Alice: 8 },
      gameScores: {
        clutch: { Alice: 8, Bob: 2 },
        trivia: { Bob: 8 },
      },
    };
    const clutch = buildEveningStandingPlayers({ ...maps, gameId: "clutch" });
    const trivia = buildEveningStandingPlayers({ ...maps, gameId: "trivia" });
    assert.deepEqual(namesOf(clutch), ["Alice", "Bob"]);
    assert.deepEqual(namesOf(trivia), ["Bob"]);
  });

  it("11. absence de badge n’empêche pas la ligne (objet affichable complet)", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [bob],
      scores: { Alice: 5 },
      gameScores: {},
    });
    const alice = players.find((p) => p.name === "Alice");
    assert.ok(alice);
    assert.equal("badge" in alice, false);
    assert.ok(alice.name && alice.emoji && alice.color);
  });

  it("12. idempotence : deux builds → mêmes noms, pas de doublon", () => {
    const opts = {
      activePlayers: [bob, { name: "Bob", color: "#111", emoji: "🅱️" }],
      scores: { Bob: 1, Alice: 2 },
      gameScores: { clutch: { Alice: 2 } },
    };
    const a = buildEveningStandingPlayers(opts);
    const b = buildEveningStandingPlayers(opts);
    assert.deepEqual(namesOf(a), namesOf(b));
    assert.equal(a.filter((p) => p.name === "Bob").length, 1);
    assert.equal(a.filter((p) => p.name === "Alice").length, 1);
  });

  it("collectEveningContributorNames couvre scores non nuls + clés gameScores", () => {
    const set = collectEveningContributorNames({
      scores: { A: 1, B: 0, C: -2 },
      gameScores: { g: { B: 0, D: 3 } },
    });
    assert.deepEqual([...set].sort(), ["A", "B", "C", "D"]);
  });
});

describe("UX-HIST-01 - getActivePlayers / getSortedActivePlayers inchangés", () => {
  it("getActivePlayers / getSortedActivePlayers restent roster-only (corps inchangé)", () => {
    const src = readFileSync(join(root, "js/core/players.js"), "utf8");
    const active = src.slice(
      src.indexOf("export function getActivePlayers"),
      src.indexOf("export function getActivePlayerNames")
    );
    const sorted = src.slice(
      src.indexOf("export function getSortedActivePlayers"),
      src.indexOf("export function getEveningStandingPlayers")
    );
    assert.equal(active.includes("buildEveningStandingPlayers"), false);
    assert.equal(sorted.includes("buildEveningStandingPlayers"), false);
    assert.match(sorted, /syncAllPlayerScores/);
    assert.match(src, /export function getEveningStandingPlayers/);
  });

  it("HUD in-game (gameCumulativeScoresHtml) reste sur getSortedActivePlayers", () => {
    const src = readFileSync(join(root, "js/core/gameScores.js"), "utf8");
    const cum = src.slice(
      src.indexOf("export function gameCumulativeScoresHtml"),
      src.indexOf("export function refreshGameScoresBox")
    );
    assert.match(cum, /getSortedActivePlayers\(\)/);
    assert.equal(cum.includes("getEveningStandingPlayers"), false);
  });

  it("surfaces historiques branchées sur le sélecteur soirée", () => {
    const recap = readFileSync(join(root, "js/core/eveningRecap.js"), "utf8");
    const lb = readFileSync(join(root, "js/screens/leaderboard.js"), "utf8");
    const gs = readFileSync(join(root, "js/core/gameScores.js"), "utf8");
    assert.match(recap, /getSortedEveningStandingPlayers/);
    assert.match(lb, /getSortedEveningStandingPlayers/);
    assert.match(gs, /getEveningStandingPlayers\(\{ gameId: gid \}\)/);
  });
});
