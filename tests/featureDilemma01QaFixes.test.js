/**
 * FEATURE-DILEMMA-01 - correctifs QA (compteur, leave prep, deck mixte).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCombinedShuffledDeck,
  countOtherAuthorsCustomEntries,
  shuffleArray,
} from "../js/core/combinedGameDeck.js";
import { resolveEffectiveRoundCount } from "../js/core/dilemmaDuration.js";
import { normalizeDilemmaEntry } from "../js/core/sessionMerge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-DILEMMA-01 QA - compteur others", () => {
  const norm = (e) => normalizeDilemmaEntry(e);

  it("3 customs autre joueur → hint 3", () => {
    const list = [
      { id: "b1", optionA: "A", optionB: "B", author: "Bob" },
      { id: "b2", optionA: "C", optionB: "D", author: "Bob" },
      { id: "b3", optionA: "E", optionB: "F", author: "Bob" },
    ];
    assert.equal(countOtherAuthorsCustomEntries(list, "Alice", norm), 3);
  });

  it("suppression distante → hint 2", () => {
    const list = [
      { id: "b1", optionA: "A", optionB: "B", author: "Bob" },
      { id: "b2", optionA: "C", optionB: "D", author: "Bob" },
    ];
    assert.equal(countOtherAuthorsCustomEntries(list, "Alice", norm), 2);
  });

  it("ajout après suppression → hint 3", () => {
    const list = [
      { id: "b1", optionA: "A", optionB: "B", author: "Bob" },
      { id: "b2", optionA: "C", optionB: "D", author: "Bob" },
      { id: "b4", optionA: "G", optionB: "H", author: "Bob" },
    ];
    assert.equal(countOtherAuthorsCustomEntries(list, "Alice", norm), 3);
  });

  it("dernier supprimé → 0", () => {
    assert.equal(countOtherAuthorsCustomEntries([], "Alice", norm), 0);
  });

  it("n compte pas le joueur local", () => {
    const list = [
      { id: "a1", optionA: "A", optionB: "B", author: "Alice" },
      { id: "b1", optionA: "C", optionB: "D", author: "Bob" },
    ];
    assert.equal(countOtherAuthorsCustomEntries(list, "Alice", norm), 1);
  });

  it("ids dupliqués dans snapshot → compte unique", () => {
    const list = [
      { id: "b1", optionA: "A", optionB: "B", author: "Bob" },
      { id: "b1", optionA: "A", optionB: "B", author: "Bob" },
    ];
    assert.equal(countOtherAuthorsCustomEntries(list, "Alice", norm), 1);
  });
});

describe("FEATURE-DILEMMA-01 QA - deck mixte global", () => {
  const customs = Array.from({ length: 6 }, (_, i) => ({
    id: `c-${i}`,
    tier: "custom",
    author: "Alice",
  }));
  const bank = Array.from({ length: 10 }, (_, i) => ({
    id: `bank-${i}`,
    tier: "catalog",
  }));

  it("12 customs + catalog large + 8 manches → 8 customs uniquement", () => {
    const customs = Array.from({ length: 12 }, (_, i) => ({
      id: `c-${i}`,
      tier: "custom",
      author: "Alice",
    }));
    const bank = Array.from({ length: 100 }, (_, i) => ({ id: `bank-${i}` }));
    const deck = buildCombinedShuffledDeck(
      customs,
      bank,
      8,
      resolveEffectiveRoundCount,
      () => 0.33
    );
    assert.equal(deck.length, 8);
    assert.equal(deck.filter((d) => d.tier === "custom").length, 8);
  });

  it("6 customs + bank : tous les customs inclus malgré catalog large", () => {
    const customs = Array.from({ length: 6 }, (_, i) => ({
      id: `c-${i}`,
      tier: "custom",
      author: "Alice",
    }));
    const bank = Array.from({ length: 100 }, (_, i) => ({
      id: `bank-${i}`,
    }));
    const deck = buildCombinedShuffledDeck(
      customs,
      bank,
      8,
      resolveEffectiveRoundCount,
      () => 0.33
    );
    assert.equal(deck.length, 8);
    assert.equal(deck.filter((d) => d.tier === "custom").length, 6);
  });

  it("RNG fixe : deck ≠ concat customs puis bank (shuffle global)", () => {
    const deck = buildCombinedShuffledDeck(
      customs.slice(0, 6),
      bank.slice(0, 4),
      8,
      resolveEffectiveRoundCount,
      () => 0.33
    );
    assert.equal(deck.length, 8);
    const kinds = deck.map((d) => (String(d.id).startsWith("c-") ? "c" : "b"));
    const concatPattern = ["c", "c", "c", "c", "c", "c", "b", "b"];
    assert.notDeepEqual(kinds, concatPattern);
    assert.ok(kinds.includes("c"));
    assert.ok(kinds.includes("b"));
  });

  it("prédéfini peut apparaître en première manche (pool combiné)", () => {
    const smallCustoms = [customs[0]];
    const smallBank = [bank[0], bank[1]];
    let i = 0;
    const random = () => [0.95, 0.05, 0.5][i++ % 3];
    const deck = buildCombinedShuffledDeck(
      smallCustoms,
      smallBank,
      3,
      resolveEffectiveRoundCount,
      random
    );
    assert.ok(deck.some((d) => String(d.id).startsWith("bank-")));
    assert.ok(deck.some((d) => String(d.id).startsWith("c-")));
  });

  it("slice après shuffle - longueur = roundCount effectif", () => {
    const deck = buildCombinedShuffledDeck(
      customs,
      bank,
      5,
      resolveEffectiveRoundCount,
      () => 0.5
    );
    assert.equal(deck.length, 5);
  });

  it("IDs uniques dans le deck", () => {
    const deck = buildCombinedShuffledDeck(
      customs,
      bank,
      8,
      resolveEffectiveRoundCount,
      () => 0.42
    );
    const ids = deck.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("buildDilemmaDeck source utilise buildDilemmaDeckEntries", () => {
    const src = read("js/core/dilemmaSession.js");
    assert.match(src, /buildDilemmaDeckEntries/);
    assert.doesNotMatch(src, /customsKept.*bankKept/s);
  });
});

describe("FEATURE-DILEMMA-01 QA - leave prep wiring", () => {
  it("dilemmaPrep refresh session on lobby change", () => {
    const src = read("js/screens/dilemmaPrep.js");
    assert.match(src, /runPrepRefreshOnLobbyChange/);
    assert.match(src, /refreshGameSession/);
    assert.match(src, /onLobbyBundleUpdated/);
  });

  it("hotTakePrep même contrat leave", () => {
    const src = read("js/screens/hotTakePrep.js");
    assert.match(src, /runPrepRefreshOnLobbyChange/);
  });
});

describe("FEATURE-DILEMMA-01 QA - shuffleArray déterministe", () => {
  it("conserve les éléments du pool", () => {
    const input = [1, 2, 3, 4];
    const out = shuffleArray(input, () => 0.33);
    assert.deepEqual([...out].sort(), [1, 2, 3, 4]);
  });
});
