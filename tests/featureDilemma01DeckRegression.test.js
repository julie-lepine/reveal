/**

 * FEATURE-DILEMMA-01 — politique d'inclusion customs dans le deck.

 */

import { describe, it, beforeEach, afterEach } from "node:test";

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";

import {

  buildCombinedShuffledDeck,

  buildDilemmaDeckEntries,

  dedupeEntriesById,

  isDilemmaCustomDeckEntry,

  prepareCombinedDeckPool,

} from "../js/core/combinedGameDeck.js";

import { resolveEffectiveRoundCount } from "../js/core/dilemmaDuration.js";

import { normalizeDilemmaEntry } from "../js/core/sessionMerge.js";

import {

  dehydrateDilemmaDeck,

  rehydrateDilemmaDeck,

} from "../js/core/deckCodec.js";

import { getState, saveStatePatch } from "../js/core/state.js";



const __dirname = dirname(fileURLToPath(import.meta.url));

const ROOT = join(__dirname, "..");



function read(rel) {

  return readFileSync(join(ROOT, rel), "utf8");

}



function normCustom(entry) {

  return normalizeDilemmaEntry(entry);

}



function custom(id, a, b, author = "Alice") {

  return { id, optionA: a, optionB: b, author, tier: "custom" };

}



function bank(id, a, b) {

  return { id, optionA: a, optionB: b };

}



function hugeBank(n = 200) {

  return Array.from({ length: n }, (_, i) => bank(`bank-${i}`, `Ba${i}`, `Bb${i}`));

}



function detRandom(seq = []) {

  let i = 0;

  return () => seq[i++ % seq.length] ?? 0.42;

}



function build(opts) {

  return buildDilemmaDeckEntries({

    normalizeCustom: normCustom,

    resolveEffectiveRoundCount,

    ...opts,

  });

}



describe("FEATURE-DILEMMA-01 — politique inclusion customs (4 cas)", () => {

  it("cas 1 : 0 custom + 8 manches → 8 prédéfinis", () => {

    const deck = build({

      customDilemmas: [],

      bankItems: hugeBank(50),

      roundCount: 8,

      random: () => 0.33,

    });

    assert.equal(deck.length, 8);

    assert.equal(deck.filter(isDilemmaCustomDeckEntry).length, 0);

    assert.equal(deck.filter((d) => !isDilemmaCustomDeckEntry(d)).length, 8);

  });



  it("cas 2 : 3 customs + 200 prédéfinis + 8 manches → 3 customs + 5 prédéfinis", () => {

    const customs = [

      custom("c1", "A1", "B1"),

      custom("c2", "A2", "B2"),

      custom("c3", "A3", "B3"),

    ];

    const deck = build({

      customDilemmas: customs,

      bankItems: hugeBank(),

      roundCount: 8,

      random: () => 0.99,

    });

    assert.equal(deck.length, 8);

    assert.equal(deck.filter(isDilemmaCustomDeckEntry).length, 3);

    assert.equal(deck.filter((d) => !isDilemmaCustomDeckEntry(d)).length, 5);

  });



  it("cas 2 bis : 6 customs + 2 prédéfinis + 8 manches → les 8 entrées", () => {

    const customs = Array.from({ length: 6 }, (_, i) =>

      custom(`c-${i}`, `Ca${i}`, `Cb${i}`)

    );

    const deck = build({

      customDilemmas: customs,

      bankItems: [bank("b1", "X", "Y"), bank("b2", "P", "Q")],

      roundCount: 8,

      random: () => 0.5,

    });

    assert.equal(deck.length, 8);

    assert.equal(deck.filter(isDilemmaCustomDeckEntry).length, 6);

    assert.equal(deck.filter((d) => !isDilemmaCustomDeckEntry(d)).length, 2);

  });



  it("cas 3 : 8 customs + 200 prédéfinis + 8 manches → 8 customs, aucun prédéfini", () => {

    const customs = Array.from({ length: 8 }, (_, i) =>

      custom(`c-${i}`, `Ca${i}`, `Cb${i}`)

    );

    const deck = build({

      customDilemmas: customs,

      bankItems: hugeBank(),

      roundCount: 8,

      random: () => 0.1,

    });

    assert.equal(deck.length, 8);

    assert.equal(deck.filter(isDilemmaCustomDeckEntry).length, 8);

    assert.equal(deck.filter((d) => !isDilemmaCustomDeckEntry(d)).length, 0);

  });



  it("cas 4 : 12 customs + 200 prédéfinis + 8 manches → exactement 8 customs", () => {

    const customs = Array.from({ length: 12 }, (_, i) =>

      custom(`c-${i}`, `Ca${i}`, `Cb${i}`)

    );

    const deck = build({

      customDilemmas: customs,

      bankItems: hugeBank(),

      roundCount: 8,

      random: () => 0.55,

    });

    assert.equal(deck.length, 8);

    assert.equal(deck.filter(isDilemmaCustomDeckEntry).length, 8);

    assert.equal(deck.filter((d) => !isDilemmaCustomDeckEntry(d)).length, 0);

  });



  it("cas 4 bis : sélection aléatoire parmi 12 customs (pas les 8 premiers)", () => {

    const customs = Array.from({ length: 12 }, (_, i) =>

      custom(`c-${i}`, `Ca${i}`, `Cb${i}`)

    );

    let sawLateCustom = false;

    for (let seed = 0; seed < 80; seed += 1) {

      let call = 0;

      const random = () => ((seed * 0.173 + call++ * 0.611) % 1);

      const deck = build({

        customDilemmas: customs,

        bankItems: hugeBank(),

        roundCount: 8,

        random,

      });

      const ids = deck.map((d) => d.id);

      if (ids.includes("c-11") || ids.includes("c-10")) {

        sawLateCustom = true;

        break;

      }

    }

    assert.equal(sawLateCustom, true, "un custom tardif doit parfois être sélectionné");

  });



  it("effective ne dépasse jamais le pool normalisé", () => {

    const deck = build({

      customDilemmas: [custom("c1", "A", "B")],

      bankItems: [bank("b1", "X", "Y")],

      roundCount: 999,

      random: () => 0.5,

    });

    assert.equal(deck.length, 2);

  });

});



describe("FEATURE-DILEMMA-01 — shuffle et ordre", () => {

  it("prédéfini peut apparaître avant custom (cas mixte)", () => {

    const deck = build({

      customDilemmas: [custom("c1", "A", "B"), custom("c2", "C", "D")],

      bankItems: [bank("b1", "X", "Y"), bank("b2", "P", "Q")],

      roundCount: 4,

      random: detRandom([0.99, 0.01, 0.5, 0.5, 0.5]),

    });

    const kinds = deck.map((d) => (isDilemmaCustomDeckEntry(d) ? "c" : "b"));

    assert.ok(kinds.includes("c"));

    assert.ok(kinds.includes("b"));

  });



  it("custom peut apparaître en première position", () => {

    let customFirst = false;

    for (let seed = 0; seed < 50; seed += 1) {

      let call = 0;

      const random = () => ((seed * 0.137 + call++ * 0.619) % 1);

      const deck = build({

        customDilemmas: [custom("c-first", "A", "B")],

        bankItems: [bank("b1", "X", "Y"), bank("b2", "P", "Q")],

        roundCount: 3,

        random,

      });

      if (isDilemmaCustomDeckEntry(deck[0])) {

        customFirst = true;

        break;

      }

    }

    assert.equal(customFirst, true);

  });



  it("plusieurs customs consécutifs autorisés (shuffle réel)", () => {

    const customs = Array.from({ length: 5 }, (_, i) =>

      custom(`c-${i}`, `A${i}`, `B${i}`)

    );

    let sawConsecutive = false;

    for (let seed = 0; seed < 100; seed += 1) {

      let call = 0;

      const random = () => ((seed * 0.091 + call++ * 0.733) % 1);

      const deck = build({

        customDilemmas: customs,

        bankItems: [],

        roundCount: 5,

        random,

      });

      const kinds = deck.map(() => "c");

      for (let i = 0; i < kinds.length - 2; i += 1) {

        if (kinds[i] === "c" && kinds[i + 1] === "c" && kinds[i + 2] === "c") {

          sawConsecutive = true;

          break;

        }

      }

      if (sawConsecutive) break;

    }

    assert.equal(sawConsecutive, true, "3 customs consécutifs statistiquement possibles");

  });



  it("RNG injecté : deck ≠ concat customs puis bank", () => {

    const customs = Array.from({ length: 3 }, (_, i) =>

      custom(`c-${i}`, `A${i}`, `B${i}`)

    );

    const deck = buildCombinedShuffledDeck(

      customs,

      [bank("b1", "X", "Y"), bank("b2", "P", "Q"), bank("b3", "R", "S")],

      5,

      resolveEffectiveRoundCount,

      detRandom([0.8, 0.2, 0.6, 0.4, 0.7, 0.3])

    );

    const kinds = deck.map((d) => (isDilemmaCustomDeckEntry(d) ? "c" : "b"));

    assert.notDeepEqual(kinds, ["c", "c", "c", "b", "b"]);

  });



  it("plus de slice sur pool global géant quand customs > effective", () => {

    const customs = Array.from({ length: 12 }, (_, i) =>

      custom(`c-${i}`, `A${i}`, `B${i}`)

    );

    const deck = buildCombinedShuffledDeck(

      customs,

      hugeBank(),

      8,

      resolveEffectiveRoundCount,

      () => 0.01

    );

    assert.equal(deck.length, 8);

    assert.equal(deck.every(isDilemmaCustomDeckEntry), true);

    assert.equal(deck.some((d) => String(d.id).startsWith("bank-")), false);

  });

});



describe("FEATURE-DILEMMA-01 — déduplication et collisions", () => {

  it("IDs finaux uniques", () => {

    const deck = build({

      customDilemmas: [custom("c1", "A", "B")],

      bankItems: [bank("b1", "X", "Y")],

      roundCount: 2,

    });

    const ids = deck.map((d) => d.id);

    assert.equal(new Set(ids).size, ids.length);

  });



  it("customs dupliqués par id → un seul conservé", () => {
    const dup = custom("c-dup", "A", "B");
    const deck = build({
      customDilemmas: [dup, { ...dup, optionA: "A2" }],
      bankItems: [bank("b1", "X", "Y")],
      roundCount: 2,
    });
    assert.equal(deck.filter((d) => d.id === "c-dup").length, 1);
    assert.ok(["A", "A2"].includes(deck.find((d) => d.id === "c-dup").optionA));
  });

  it("collision id custom / banque → custom gagne, banque exclue", () => {
    const colliding = custom("sleep-hot", "Custom A", "Custom B");
    const bankEntry = bank("sleep-hot", "Bank X", "Bank Y");
    const { customs, bank: bankPool } = prepareCombinedDeckPool(
      [colliding],
      [bankEntry, bank("b2", "P", "Q")]
    );
    assert.equal(customs.length, 1);
    assert.equal(bankPool.length, 1);
    assert.equal(bankPool[0].id, "b2");

    const deck = build({
      customDilemmas: [colliding],
      bankItems: [bankEntry, bank("b2", "P", "Q")],
      roundCount: 2,
    });
    assert.ok(deck.some((d) => d.id === "sleep-hot" && isDilemmaCustomDeckEntry(d)));
    assert.equal(deck.filter((d) => d.id === "sleep-hot").length, 1);
    const customRow = deck.find((d) => d.id === "sleep-hot");
    const dry = dehydrateDilemmaDeck([customRow]);
    assert.deepEqual(dry[0], { c: customRow });
  });



  it("aucun quota par auteur", () => {

    const customs = [

      custom("a1", "A", "B", "Alice"),

      custom("a2", "C", "D", "Alice"),

      custom("a3", "E", "F", "Alice"),

      custom("b1", "G", "H", "Bob"),

    ];

    const deck = build({

      customDilemmas: customs,

      bankItems: hugeBank(),

      roundCount: 4,

    });

    assert.equal(deck.filter(isDilemmaCustomDeckEntry).length, 4);

    assert.equal(deck.filter((d) => d.author === "Alice").length, 3);

  });



  it("custom d'auteur parti toujours sélectionnable", () => {

    const deck = build({

      customDilemmas: [custom("c-gone", "A", "B", "BobLeft")],

      bankItems: [bank("b1", "X", "Y")],

      roundCount: 2,

    });

    assert.ok(deck.some((d) => d.id === "c-gone"));

  });



  it("custom consommé exclu avant sélection", () => {

    const deck = build({

      customDilemmas: [

        custom("c-active", "A", "B"),

        custom("c-played", "C", "D"),

      ].filter((d) => d.id !== "c-played"),

      bankItems: [bank("b1", "X", "Y")],

      roundCount: 2,

    });

    assert.ok(deck.some((d) => d.id === "c-active"));

    assert.equal(deck.some((d) => d.id === "c-played"), false);

  });



  it("dedupeEntriesById export utilitaire", () => {

    const out = dedupeEntriesById([

      { id: "x", v: 1 },

      { id: "x", v: 2 },

      { id: "y", v: 3 },

    ]);

    assert.equal(out.length, 2);

    assert.equal(out[0].v, 1);

  });

});



describe("FEATURE-DILEMMA-01 — chemin session et codec", () => {

  let snapshot;



  beforeEach(() => {

    snapshot = structuredClone(getState());

  });



  afterEach(() => {

    saveStatePatch(snapshot);

  });



  it("buildDilemmaDeckEntries + catalogue réel : customs garantis", async () => {

    const { getDilemmaDeckItems, DILEMMA_CATALOG_ID } = await import("../data/dilemma.js");



    saveStatePatch({

      dilemmaGame: {

        customDilemmas: [custom("c1", "Mine A", "Mine B"), custom("c2", "Mine C", "Mine D")],

        selectedDeckId: DILEMMA_CATALOG_ID,

        roundCount: 8,

        deck: null,

        lobbyStarted: false,

      },

    });



    const session = getState().dilemmaGame;

    const deck = build({

      customDilemmas: session.customDilemmas,

      bankItems: getDilemmaDeckItems(session.selectedDeckId),

      roundCount: 8,

      random: () => 0.25,

    });



    assert.equal(deck.length, 8);

    assert.equal(deck.filter(isDilemmaCustomDeckEntry).length, 2);

  });



  it("round-trip codec custom inchangé", () => {

    const deck = build({

      customDilemmas: [custom("c1", "A", "B")],

      bankItems: [bank("b-only", "X", "Y")],

      roundCount: 2,

    });

    const roundTrip = rehydrateDilemmaDeck(dehydrateDilemmaDeck(deck));

    assert.equal(roundTrip.length, 2);

    assert.equal(roundTrip.filter(isDilemmaCustomDeckEntry).length, 1);

    assert.ok(roundTrip.every((d) => d.optionA && d.optionB));

  });



  it("vote / reveal / consume pipeline non modifié", () => {

    const src = read("js/core/dilemmaSession.js");

    assert.match(src, /export function countDilemmaResults/);

    assert.match(src, /export async function consumePlayedCustomDilemma/);

    assert.doesNotMatch(src, /totalAvailable/);

  });



  it("buildDilemmaDeck source utilise buildDilemmaDeckEntries sans totalAvailable externe", () => {

    const src = read("js/core/dilemmaSession.js");

    assert.match(src, /buildDilemmaDeckEntries/);

    const combinedSrc = read("js/core/combinedGameDeck.js");

    assert.doesNotMatch(combinedSrc, /totalAvailable,\s*\n\s*resolveEffectiveRoundCount/);

  });

});


