/**
 * Bouton 🎲 flottant sur game-select (au-dessus du 💬).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rouletteFabState } from "../js/core/rouletteFab.js";
import { isRouletteFabScreen } from "../js/core/chatFabScreens.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, "..", p), "utf8");

describe("bouton 🎲 roulette sur game-select", () => {
  it("n'existe que sur game-select", () => {
    assert.equal(isRouletteFabScreen("game-select"), true);
    for (const s of ["results", "leaderboard", "lobby", "traitre-prep", "home", null]) {
      assert.equal(isRouletteFabScreen(s), false, s);
    }
  });

  it("hôte sur game-select : visible et actif", () => {
    assert.deepEqual(
      rouletteFabState({ screenId: "game-select", canOffer: true, enabled: true }),
      { show: true, enabled: true }
    );
  });

  it("invité sur game-select : visible mais inactif", () => {
    assert.deepEqual(
      rouletteFabState({ screenId: "game-select", canOffer: true, enabled: false }),
      { show: true, enabled: false }
    );
  });

  it("hors salon ou phase non permise : masqué", () => {
    assert.deepEqual(
      rouletteFabState({ screenId: "game-select", canOffer: false, enabled: true }),
      { show: false, enabled: false }
    );
  });

  it("autre écran du hub : masqué même pour l'hôte", () => {
    assert.deepEqual(
      rouletteFabState({ screenId: "results", canOffer: true, enabled: true }),
      { show: false, enabled: false }
    );
  });

  it("le 🎲 du chat est masqué sur les écrans qui ont le bouton flottant", () => {
    const src = read("js/core/chatRandomGame.js");
    const start = src.indexOf("export function renderChatRandomGameCta");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.match(body, /isRouletteFabScreen\(getCurrentScreen\(\)\)/);
  });

  it("monté au démarrage avec le 💬", () => {
    const main = read("js/main.js");
    assert.ok(main.indexOf("initRouletteFab();") > main.indexOf("initFeedbackFab();"));
  });
});
