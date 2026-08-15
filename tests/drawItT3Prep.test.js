/**
 * Draw it ! T3 — prépa : catégorie, manches, pool, estimation, confidentialité.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRAW_IT_CATALOG_ID,
  DRAW_IT_CATEGORIES,
  DRAW_IT_ROUND_PRESETS,
  DRAW_IT_WORDS,
  getDrawItCategoryWords,
} from "../data/drawIt.js";

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const {
  defaultDrawItPrepSession,
  getDrawItSession,
  setDrawItCategory,
  setDrawItRoundCount,
  validateDrawItPrep,
  buildDrawItSeries,
  getDrawItPrepSummary,
  markDrawItLobbyStarted,
  isDrawItCategoryId,
  isDrawItRoundCount,
  drawItToRemote,
} = await import("../js/core/drawItSession.js");
const { estimateDrawItDuration } = await import("../js/core/drawItDuration.js");
const { saveStatePatch } = await import("../js/core/state.js");

function makeWords(count, categoryId, prefix = categoryId) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${i + 1}`,
    label: `${prefix}-${i + 1}`,
    categoryId,
    enabled: true,
  }));
}

const PUBLIC_FORBIDDEN = ["deck", "words", "wordId", "wordLabel", "acceptedAnswers"];

describe("Draw it ! T3 — catégorie", () => {
  beforeEach(() => {
    saveStatePatch({ drawItGame: defaultDrawItPrepSession() });
  });

  it("catégorie valide acceptée", async () => {
    assert.equal(isDrawItCategoryId(DRAW_IT_CATALOG_ID), true);
    assert.equal(isDrawItCategoryId("demo"), true);
    await setDrawItCategory("demo");
    assert.equal(getDrawItSession().selectedCategoryId, "demo");
    assert.equal(
      validateDrawItPrep({ selectedCategoryId: "demo", roundCount: 3 }).valid,
      true
    );
  });

  it("catégorie inconnue refusée", () => {
    assert.equal(isDrawItCategoryId("inconnu"), false);
    const check = validateDrawItPrep({
      selectedCategoryId: "inconnu",
      roundCount: 3,
    });
    assert.equal(check.valid, false);
    assert.equal(check.reason, "invalid_category");
  });

  it("sélection catégorie ne mute pas le catalogue", async () => {
    const before = JSON.stringify(DRAW_IT_WORDS);
    const beforeCats = JSON.stringify(DRAW_IT_CATEGORIES);
    await setDrawItCategory("demo");
    await setDrawItCategory(DRAW_IT_CATALOG_ID);
    assert.equal(JSON.stringify(DRAW_IT_WORDS), before);
    assert.equal(JSON.stringify(DRAW_IT_CATEGORIES), beforeCats);
  });
});

describe("Draw it ! T3 — nombre de manches", () => {
  it("presets 3 / 5 / 8 acceptés", () => {
    for (const n of DRAW_IT_ROUND_PRESETS) {
      assert.equal(isDrawItRoundCount(n), true);
    }
    const words = makeWords(8, "demo");
    assert.equal(
      validateDrawItPrep({ selectedCategoryId: "demo", roundCount: 3 }, words).valid,
      true
    );
    assert.equal(
      validateDrawItPrep({ selectedCategoryId: "demo", roundCount: 5 }, words).valid,
      true
    );
    assert.equal(
      validateDrawItPrep({ selectedCategoryId: "demo", roundCount: 8 }, words).valid,
      true
    );
  });

  it("valeur invalide refusée sans coercion", () => {
    const words = makeWords(8, "demo");
    for (const n of [0, 1, 4, 7, 9, -1, 2.5]) {
      const check = validateDrawItPrep(
        { selectedCategoryId: "demo", roundCount: n },
        words
      );
      assert.equal(check.valid, false, String(n));
      assert.equal(check.reason, "invalid_round_count", String(n));
    }
  });
});

describe("Draw it ! T3 — pool et série", () => {
  it("pool suffisant → configuration valide", () => {
    const check = validateDrawItPrep({
      selectedCategoryId: "demo",
      roundCount: 3,
    });
    assert.equal(check.valid, true);
    assert.equal(check.poolSize, 3);
    assert.equal(check.required, 3);
  });

  it("pool insuffisant → configuration invalide", () => {
    const check = validateDrawItPrep({
      selectedCategoryId: "demo",
      roundCount: 5,
    });
    assert.equal(check.valid, false);
    assert.equal(check.reason, "insufficient_pool");
    assert.equal(check.poolSize, 3);
    assert.equal(check.required, 5);
  });

  it("série sans doublons, limitée à roundCount, dans la catégorie", () => {
    const words = [...makeWords(6, "demo"), ...makeWords(6, "other")];
    const series = buildDrawItSeries(
      { selectedCategoryId: "demo", roundCount: 5 },
      words
    );
    assert.equal(series.length, 5);
    assert.equal(new Set(series.map((w) => w.id)).size, 5);
    assert.ok(series.every((w) => w.categoryId === "demo"));
  });

  it("catalogue source inchangé après construction (copie)", () => {
    const words = makeWords(8, "demo");
    const snapshot = JSON.stringify(words);
    const catalog = JSON.stringify(DRAW_IT_WORDS);
    buildDrawItSeries({ selectedCategoryId: "demo", roundCount: 5 }, words);
    getDrawItCategoryWords("demo", words);
    assert.equal(JSON.stringify(words), snapshot);
    assert.equal(JSON.stringify(DRAW_IT_WORDS), catalog);
  });

  it("série invalide → tableau vide, pas d'écriture session", () => {
    saveStatePatch({ drawItGame: defaultDrawItPrepSession() });
    const series = buildDrawItSeries({
      selectedCategoryId: "demo",
      roundCount: 8,
    });
    assert.deepEqual(series, []);
    const session = getDrawItSession();
    for (const key of PUBLIC_FORBIDDEN) {
      assert.equal(key in session, false, key);
    }
  });
});

describe("Draw it ! T3 — confidentialité + estimation", () => {
  beforeEach(() => {
    saveStatePatch({ drawItGame: defaultDrawItPrepSession() });
  });

  it("codec / état sync sans deck ni mots", async () => {
    await setDrawItCategory("demo");
    await setDrawItRoundCount(3);
    buildDrawItSeries({
      selectedCategoryId: getDrawItSession().selectedCategoryId,
      roundCount: getDrawItSession().roundCount,
    });
    const remote = drawItToRemote(getDrawItSession());
    assert.deepEqual(Object.keys(remote).sort(), [
      "lobbyStarted",
      "ready",
      "roundCount",
      "selectedCategoryId",
    ]);
    for (const key of PUBLIC_FORBIDDEN) {
      assert.equal(key in remote, false, `remote.${key}`);
      assert.equal(key in getDrawItSession(), false, `session.${key}`);
    }
  });

  it("estimation = roundCount × 60 s", () => {
    assert.equal(estimateDrawItDuration(3).minSec, 180);
    assert.equal(estimateDrawItDuration(5).minSec, 300);
    assert.equal(estimateDrawItDuration(8).minSec, 480);
    assert.equal(estimateDrawItDuration(3).maxSec, 180);
    assert.equal(estimateDrawItDuration(0).label, "-");
  });

  it("summary expose durationLabel sans inventer un deck", async () => {
    await setDrawItRoundCount(3);
    const prep = getDrawItPrepSummary();
    assert.equal(prep.durationMinSec, 180);
    assert.ok(prep.durationLabel);
    assert.equal(prep.capped, false);
    assert.equal("deck" in getDrawItSession(), false);
  });

  it("render prépa passe prep à drawItStartSlotHtml (évite crash .valid)", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../js/screens/drawItPrep.js"),
      "utf8"
    );
    assert.match(src, /drawItStartSlotHtml\(allReady,\s*prep\)/);
    assert.doesNotMatch(src, /drawItStartSlotHtml\(allReady\s*\)/);
  });

  it("lancement bloqué si pool insuffisant", async () => {
    await setDrawItRoundCount(8);
    const result = await markDrawItLobbyStarted();
    assert.equal(result, null);
    assert.equal(getDrawItSession().lobbyStarted, false);
  });
});
