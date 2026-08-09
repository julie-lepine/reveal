/**
 * FEATURE-TIERNIGHT-04B — domaine pur Rank Live série.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TIER_LISTS } from "../data/tierTopics.js";
import {
  CUSTOM_LIVE_TIER_LIST_ID_PREFIX,
  LIVE_TIER_LIST_ENTRY_JSON_MAX_BYTES,
  createCustomLiveTierListId,
  normalizeCustomLiveTierListInput,
  sanitizeCustomLiveTierListsCollection,
  validateCustomLiveTierList,
  validateCustomLiveTierListsForBuild,
} from "../js/core/customLiveTierLists.js";
import {
  DEFAULT_TIER_NIGHT_LIVE_SERIES_ROUND_COUNT,
  TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS,
  buildTierNightLiveSeriesListSubset,
  getTierNightLiveOfficialPool,
  isValidTierNightLiveRoundCount,
  validateTierNightLiveSeriesCategoryIdsV1,
} from "../js/core/tierNightLiveSeriesDomain.js";
import { buildCombinedShuffledDeck, shuffleArray } from "../js/core/combinedGameDeck.js";

function makeCustom(overrides = {}) {
  const n = overrides._n ?? 1;
  const { _n: _ignored, ...rest } = overrides;
  void _ignored;
  return {
    id: `${CUSTOM_LIVE_TIER_LIST_ID_PREFIX}${String(n).padStart(4, "0")}-0000-0000-0000-000000000000`,
    name: `Custom ${n}`,
    emoji: "🎯",
    items: Array.from({ length: 4 }, (_, i) => `Item-${n}-${i + 1}`),
    author: `Author${n}`,
    authorUid: `uid-${n}`,
    custom: true,
    ...rest,
  };
}

/** RNG déterministe (suite fixe). */
function seqRng(values) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

describe("FEATURE-TIERNIGHT-04B — constantes live", () => {
  it("counts 3/5/7 séparés du roster ; défaut 5", () => {
    assert.deepEqual([...TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS], [3, 5, 7]);
    assert.equal(DEFAULT_TIER_NIGHT_LIVE_SERIES_ROUND_COUNT, 5);
    assert.equal(isValidTierNightLiveRoundCount(3), true);
    assert.equal(isValidTierNightLiveRoundCount(5), true);
    assert.equal(isValidTierNightLiveRoundCount(7), true);
    assert.equal(isValidTierNightLiveRoundCount(8), false);
    assert.equal(isValidTierNightLiveRoundCount("5"), false);
    assert.equal(isValidTierNightLiveRoundCount(4), false);
  });
});

describe("FEATURE-TIERNIGHT-04B — catalogue officiel", () => {
  it("pool = TIER_LISTS (8) sans customTierLists", () => {
    assert.equal(TIER_LISTS.length, 8);
    const pool = getTierNightLiveOfficialPool();
    assert.equal(pool.length, 8);
    assert.deepEqual(
      pool.map((l) => l.id),
      TIER_LISTS.map((l) => l.id)
    );
    assert.ok(pool.every((l) => l.custom === false));
  });

  it("copie défensive : mute pool ne touche pas TIER_LISTS", () => {
    const before = TIER_LISTS[0].items[0];
    const pool = getTierNightLiveOfficialPool();
    pool[0].items[0] = "__mutated__";
    pool.pop();
    assert.equal(TIER_LISTS[0].items[0], before);
    assert.equal(TIER_LISTS.length, 8);
  });
});

describe("FEATURE-TIERNIGHT-04B — validation custom", () => {
  it("accepte une liste valide", () => {
    const res = validateCustomLiveTierList(makeCustom({ _n: 1 }));
    assert.equal(res.ok, true);
    assert.equal(res.list.custom, true);
    assert.ok(res.list.id.startsWith(CUSTOM_LIVE_TIER_LIST_ID_PREFIX));
  });

  it("name <2 / >40 reject", () => {
    assert.equal(validateCustomLiveTierList(makeCustom({ name: "A" })).ok, false);
    assert.equal(
      validateCustomLiveTierList(makeCustom({ name: "x".repeat(41) })).ok,
      false
    );
  });

  it("items <4 / >16 / blank / >40 reject", () => {
    assert.equal(
      validateCustomLiveTierList(makeCustom({ items: ["a", "b", "c"] })).ok,
      false
    );
    assert.equal(
      validateCustomLiveTierList(
        makeCustom({ items: Array.from({ length: 17 }, (_, i) => `i${i}`) })
      ).ok,
      false
    );
    assert.equal(
      validateCustomLiveTierList(makeCustom({ items: ["a", "b", "c", "  "] })).ok,
      false
    );
    assert.equal(
      validateCustomLiveTierList(
        makeCustom({ items: ["a", "b", "c", "x".repeat(41)] })
      ).ok,
      false
    );
  });

  it("doublon item case/trim-insensitive reject", () => {
    const res = validateCustomLiveTierList(
      makeCustom({ items: ["Pizza", "Burger", "Tacos", " pizza "] })
    );
    assert.equal(res.ok, false);
    assert.equal(res.code, "DUPLICATE_ITEM");
  });

  it("id sans custom-live- reject ; custom !== true / absent / string reject", () => {
    assert.equal(
      validateCustomLiveTierList(makeCustom({ id: "custom-123" })).ok,
      false
    );
    assert.equal(validateCustomLiveTierList(makeCustom({ custom: false })).ok, false);
    assert.equal(validateCustomLiveTierList(makeCustom({ custom: "true" })).ok, false);
    const bare = makeCustom({ _n: 3 });
    delete bare.custom;
    assert.equal(validateCustomLiveTierList(bare).ok, false);
  });

  it("emoji trop long reject (pas de troncature silencieuse côté validate)", () => {
    assert.equal(
      validateCustomLiveTierList(makeCustom({ emoji: "ABCDE" })).ok,
      false
    );
  });

  it("emoji défaut ✨ ; create id préfixé", () => {
    const n = normalizeCustomLiveTierListInput({
      id: createCustomLiveTierListId(),
      name: "Ok",
      items: ["a", "b", "c", "d"],
      author: "A",
      authorUid: "u",
    });
    assert.equal(n.emoji, "✨");
    assert.ok(createCustomLiveTierListId().startsWith(CUSTOM_LIVE_TIER_LIST_ID_PREFIX));
  });

  it("sanitize collection ignore invalides et déduplique", () => {
    const a = makeCustom({ _n: 1 });
    const bad = { ...makeCustom({ _n: 2 }), name: "x" };
    const dup = { ...a, name: "Other" };
    const out = sanitizeCustomLiveTierListsCollection([a, bad, dup, null]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, a.id);
  });

  it("build pool refuse duplicate custom ids", () => {
    const a = makeCustom({ _n: 1 });
    const res = validateCustomLiveTierListsForBuild([a, { ...a, name: "Copy" }]);
    assert.equal(res.ok, false);
    assert.equal(res.code, "DUPLICATE_CUSTOM_ID");
  });

  it("pas de plafond de nombre : 20 customs valides OK pour build pool", () => {
    const many = Array.from({ length: 20 }, (_, i) => makeCustom({ _n: i + 1 }));
    const res = validateCustomLiveTierListsForBuild(many);
    assert.equal(res.ok, true);
    assert.equal(res.lists.length, 20);
  });
});

describe("FEATURE-TIERNIGHT-04B — catégories V1", () => {
  it("seul [\"*\"] accepté", () => {
    assert.equal(validateTierNightLiveSeriesCategoryIdsV1(["*"]).ok, true);
    assert.equal(validateTierNightLiveSeriesCategoryIdsV1(["life"]).ok, false);
    assert.equal(validateTierNightLiveSeriesCategoryIdsV1(["*", "food"]).ok, false);
    assert.equal(validateTierNightLiveSeriesCategoryIdsV1([]).ok, false);
  });
});

describe("FEATURE-TIERNIGHT-04B — builder", () => {
  const rng = seqRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);

  it("1–3. 0 custom + R=3/5/7 → R officielles distinctes", () => {
    for (const R of [3, 5, 7]) {
      const res = buildTierNightLiveSeriesListSubset({
        roundCount: R,
        customLists: [],
        random: rng,
      });
      assert.equal(res.ok, true, `R=${R}`);
      assert.equal(res.lists.length, R);
      const ids = res.lists.map((l) => l.id);
      assert.equal(new Set(ids).size, R);
      assert.ok(res.lists.every((l) => l.custom === false));
      assert.ok(ids.every((id) => TIER_LISTS.some((t) => t.id === id)));
    }
  });

  it("4. C<R : 2 customs + R=5 → 2 customs + 3 officielles", () => {
    const customs = [makeCustom({ _n: 1 }), makeCustom({ _n: 2 })];
    const sourceLen = customs.length;
    const res = buildTierNightLiveSeriesListSubset({
      roundCount: 5,
      customLists: customs,
      random: rng,
    });
    assert.equal(res.ok, true);
    assert.equal(res.lists.length, 5);
    const customIds = res.lists.filter((l) => l.custom).map((l) => l.id);
    const officialIds = res.lists.filter((l) => !l.custom).map((l) => l.id);
    assert.equal(customIds.length, 2);
    assert.ok(customIds.includes(customs[0].id));
    assert.ok(customIds.includes(customs[1].id));
    assert.equal(officialIds.length, 3);
    assert.equal(customs.length, sourceLen);
  });

  it("5. C=R : 5 customs + R=5 → 5 customs, 0 officielle", () => {
    const customs = Array.from({ length: 5 }, (_, i) => makeCustom({ _n: i + 1 }));
    const res = buildTierNightLiveSeriesListSubset({
      roundCount: 5,
      customLists: customs,
      random: rng,
    });
    assert.equal(res.ok, true);
    assert.equal(res.lists.length, 5);
    assert.ok(res.lists.every((l) => l.custom === true));
  });

  it("6–7. C>R : 10 customs + R=5 → 5 customs ; source reste 10", () => {
    const customs = Array.from({ length: 10 }, (_, i) => makeCustom({ _n: i + 1 }));
    const res = buildTierNightLiveSeriesListSubset({
      roundCount: 5,
      customLists: customs,
      random: rng,
    });
    assert.equal(res.ok, true);
    assert.equal(res.lists.length, 5);
    assert.ok(res.lists.every((l) => l.custom === true));
    assert.equal(customs.length, 10);
    const picked = new Set(res.lists.map((l) => l.id));
    assert.ok([...picked].every((id) => customs.some((c) => c.id === id)));
  });

  it("C≫R sans plafond : 20 customs + R=3", () => {
    const customs = Array.from({ length: 20 }, (_, i) => makeCustom({ _n: i + 1 }));
    const res = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      customLists: customs,
      random: rng,
    });
    assert.equal(res.ok, true);
    assert.equal(res.lists.length, 3);
    assert.equal(customs.length, 20);
  });

  it("10. pool insuffisant → erreur ; jamais length < R", () => {
    const tinyOfficials = [
      { id: "a", name: "A", emoji: "1", items: ["1", "2", "3", "4"], custom: false },
      { id: "b", name: "B", emoji: "2", items: ["1", "2", "3", "4"], custom: false },
    ];
    const res = buildTierNightLiveSeriesListSubset({
      officialLists: tinyOfficials,
      customLists: [],
      roundCount: 5,
      random: rng,
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INSUFFICIENT_POOL");
    assert.equal(res.requested, 5);
    assert.equal(res.available, 2);
  });

  it("R=8 invalide live", () => {
    const res = buildTierNightLiveSeriesListSubset({ roundCount: 8, customLists: [] });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_ROUND_COUNT");
  });

  it("categoryIds non-star reject", () => {
    const res = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      categoryIds: ["food"],
      customLists: [],
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INVALID_CATEGORY_IDS");
  });

  it("11. customTierLists local n'entre pas dans le builder", () => {
    // Simule une liste « locale historique » sans shape shared + hors pool officiel.
    const localOnly = {
      id: "custom-999",
      name: "Local Only",
      emoji: "📦",
      items: ["a", "b", "c", "d"],
      custom: true,
    };
    // Le builder n'accepte que custom-live-* validés ; localOnly ne peut pas être passé
    // comme customLists sans échouer. Et getTierNightLiveOfficialPool ne l'inclut pas.
    const poolIds = new Set(getTierNightLiveOfficialPool().map((l) => l.id));
    assert.equal(poolIds.has(localOnly.id), false);

    const asCustom = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      customLists: [localOnly],
      random: rng,
    });
    assert.equal(asCustom.ok, false);
    assert.equal(asCustom.code, "INVALID_CUSTOM_LIVE_ID");

    const without = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      customLists: [],
      random: rng,
    });
    assert.equal(without.ok, true);
    assert.equal(
      without.lists.some((l) => l.id === localOnly.id),
      false
    );
  });

  it("immutabilité inputs + TIER_LISTS", () => {
    const customs = [makeCustom({ _n: 1 }), makeCustom({ _n: 2 })];
    const customsJson = JSON.stringify(customs);
    const tierJson = JSON.stringify(TIER_LISTS);
    const res = buildTierNightLiveSeriesListSubset({
      roundCount: 5,
      customLists: customs,
      random: rng,
    });
    assert.equal(res.ok, true);
    assert.equal(JSON.stringify(customs), customsJson);
    assert.equal(JSON.stringify(TIER_LISTS), tierJson);
  });

  it("C<R : plusieurs RNG — customs jamais évincés", () => {
    const customs = [makeCustom({ _n: 1 }), makeCustom({ _n: 2 })];
    for (let seed = 0; seed < 12; seed += 1) {
      const localRng = seqRng([
        (seed * 0.07) % 1,
        (seed * 0.13) % 1,
        (seed * 0.19) % 1,
        (seed * 0.29) % 1,
        (seed * 0.37) % 1,
        (seed * 0.41) % 1,
        (seed * 0.53) % 1,
      ]);
      const res = buildTierNightLiveSeriesListSubset({
        roundCount: 5,
        customLists: customs,
        random: localRng,
      });
      assert.equal(res.ok, true);
      const ids = new Set(res.lists.filter((l) => l.custom).map((l) => l.id));
      assert.ok(ids.has(customs[0].id), `seed ${seed}`);
      assert.ok(ids.has(customs[1].id), `seed ${seed}`);
      assert.equal(res.lists.length, 5);
    }
  });

  it("aucune taxonomie implicite sur le résultat", () => {
    const res = buildTierNightLiveSeriesListSubset({
      roundCount: 3,
      customLists: [],
      random: rng,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.categoryIds, ["*"]);
    assert.ok(res.lists.every((l) => !("categoryId" in l)));
  });
});

describe("FEATURE-TIERNIGHT-04B — combinedGameDeck non modifié (smoke)", () => {
  it("buildCombinedShuffledDeck + shuffleArray toujours disponibles", () => {
    const deck = buildCombinedShuffledDeck(
      [{ id: "c1" }, { id: "c2" }],
      [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
      3,
      (n) => Number(n) || 0,
      () => 0.2
    );
    assert.equal(deck.length, 3);
    assert.ok(deck.some((e) => e.id === "c1"));
    assert.ok(deck.some((e) => e.id === "c2"));
    const shuffled = shuffleArray([1, 2, 3], () => 0);
    assert.equal(shuffled.length, 3);
    assert.deepEqual([...shuffled].sort(), [1, 2, 3]);
  });
});

describe("FEATURE-TIERNIGHT-04B — entry JSON size", () => {
  it("ENTRY_TOO_LARGE si stringify > 4096", () => {
    const bigItems = Array.from({ length: 16 }, (_, i) =>
      `Item-${i}-${"x".repeat(40)}`.slice(0, 40)
    );
    // Forcer une entrée volumineuse via name + items déjà au max — peut rester <4096.
    // Injecte un champ author/authorUid très long avant validate via bypass normalize...
    // validate utilise list finale ; author est trimmé mais pas borné en length métier.
    const hugeAuthor = "A".repeat(5000);
    const res = validateCustomLiveTierList(
      makeCustom({
        _n: 99,
        items: bigItems,
        author: hugeAuthor,
        authorUid: "uid-99",
      })
    );
    assert.equal(res.ok, false);
    assert.equal(res.code, "ENTRY_TOO_LARGE");
    assert.ok(LIVE_TIER_LIST_ENTRY_JSON_MAX_BYTES === 4096);
  });
});
