import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRAW_IT_CATALOG_ID,
  DRAW_IT_CATEGORIES,
  DRAW_IT_ROUND_PRESETS,
  DRAW_IT_ROUND_DURATION_MS,
  DRAW_IT_WORDS,
  getDrawItCategoryWords,
} from "../data/drawIt.js";
import { GAMES, GAMES_AVAILABLE } from "../data/games.js";
import { GAME_RULES, RULES_KEY_BY_NAV } from "../data/gameRules.js";
import { SESSION_GAME_ID_TO_TILE, TILE_ID_TO_SESSION_GAME_ID } from "../js/core/gameCatalogTitle.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const { defaultDrawItPrepSession, getDrawItSession, setDrawItCategory, setDrawItRoundCount, getDrawItEntryScreen, drawItToRemote } =
  await import("../js/core/drawItSession.js");
const { saveStatePatch } = await import("../js/core/state.js");

describe("Draw it ! T1 — data", () => {
  it("durée fixe 60 s et presets alignés SpeedVote", () => {
    assert.equal(DRAW_IT_ROUND_DURATION_MS, 60_000);
    assert.deepEqual(DRAW_IT_ROUND_PRESETS, [3, 5, 8]);
  });

  it("catégories extensibles (catalog + démo)", () => {
    assert.equal(DRAW_IT_CATALOG_ID, "catalog");
    assert.ok(DRAW_IT_CATEGORIES.some((c) => c.id === DRAW_IT_CATALOG_ID));
    assert.ok(DRAW_IT_CATEGORIES.every((c) => c.id && c.label));
  });

  it("mots démo ont la shape future (id, label, categoryId, enabled)", () => {
    assert.ok(DRAW_IT_WORDS.length >= 1);
    for (const word of DRAW_IT_WORDS) {
      assert.ok(word.id);
      assert.ok(word.label);
      assert.ok(word.categoryId);
      assert.equal(word.enabled, true);
    }
    assert.ok(getDrawItCategoryWords("Facile").length > 0);
    assert.ok(getDrawItCategoryWords(DRAW_IT_CATALOG_ID).length >= getDrawItCategoryWords("Facile").length);
  });
});

describe("Draw it ! T1 — enregistrement catalogue", () => {
  it("est un jeu enabled du catalogue", () => {
    const tile = GAMES.find((g) => g.id === "drawit-prep");
    assert.ok(tile);
    assert.equal(tile.title, "Draw it !");
    assert.equal(tile.enabled, true);
    assert.ok(GAMES_AVAILABLE.some((g) => g.id === "drawit-prep"));
  });

  it("a des règles et un mapping nav", () => {
    assert.ok(GAME_RULES.drawit);
    assert.equal(RULES_KEY_BY_NAV["drawit-prep"], "drawit");
  });

  it("mappe session drawit → tuile drawit-prep", () => {
    assert.equal(SESSION_GAME_ID_TO_TILE.drawit, "drawit-prep");
    assert.equal(TILE_ID_TO_SESSION_GAME_ID["drawit-prep"], "drawit");
  });

  it("enregistre les écrans drawit-prep et drawit", () => {
    const main = read("js/main.js");
    assert.match(main, /registerScreen\("drawit-prep", mountDrawItPrep\)/);
    assert.match(main, /registerScreen\("drawit", mountDrawIt\)/);
  });

  it("branche le lancement catalogue et restart", () => {
    const select = read("js/screens/gameSelect.js");
    const restart = read("js/core/restartGame.js");
    assert.match(select, /"drawit-prep": launchDrawItPrep/);
    assert.match(restart, /export async function launchDrawItPrep/);
    assert.match(restart, /drawit: launchDrawItPrep/);
  });
});

describe("Draw it ! T1 — session prépa", () => {
  beforeEach(() => {
    saveStatePatch({ drawItGame: defaultDrawItPrepSession() });
  });

  it("default a la shape prépa uniquement", () => {
    const session = defaultDrawItPrepSession();
    assert.deepEqual(Object.keys(session).sort(), [
      "customWords",
      "lobbyStarted",
      "ready",
      "roundCount",
      "selectedCategoryId",
    ]);
    assert.deepEqual(session.ready, {});
    assert.deepEqual(session.customWords, []);
    assert.equal(session.lobbyStarted, false);
    assert.equal(session.selectedCategoryId, DRAW_IT_CATALOG_ID);
    assert.equal(session.roundCount, 5);
    assert.equal("strokes" in session, false);
    assert.equal("guesses" in session, false);
    assert.equal("foundOrder" in session, false);
    assert.equal("drawerOrder" in session, false);
  });

  it("conserve selectedCategoryId et roundCount", async () => {
    await setDrawItCategory("Facile");
    await setDrawItRoundCount(8);
    const session = getDrawItSession();
    assert.equal(session.selectedCategoryId, "Facile");
    assert.equal(session.roundCount, 8);
  });

  it("entry screen : prépa tant que lobbyStarted est faux", () => {
    assert.equal(getDrawItEntryScreen(), "drawit-prep");
    saveStatePatch({
      drawItGame: { ...getDrawItSession(), lobbyStarted: true },
    });
    assert.equal(getDrawItEntryScreen(), "drawit");
  });

  it("toRemote ne transporte que les champs prépa", () => {
    const remote = drawItToRemote({
      ready: {},
      lobbyStarted: false,
      selectedCategoryId: "Facile",
      roundCount: 3,
    });
    assert.deepEqual(Object.keys(remote).sort(), [
      "lobbyStarted",
      "ready",
      "roundCount",
      "selectedCategoryId",
    ]);
    assert.equal(remote.selectedCategoryId, "Facile");
    assert.equal(remote.roundCount, 3);
    assert.equal(remote.lobbyStarted, false);
    assert.deepEqual(remote.ready, {});
    assert.equal("strokes" in remote, false);
    assert.equal("guesses" in remote, false);
  });
});
