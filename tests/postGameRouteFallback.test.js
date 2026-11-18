/**
 * Filet post-partie : après completeGameSession, l'hôte resté sur l'écran du jeu
 * rejoint les résultats (bug « Voir les résultats » sans effet, Clutch).
 *
 * Pas d'import de gameSync.js réel (cycle Node) : décision pure + contrats source.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { postGameFallbackTarget } from "../js/core/postGameRouteFallback.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const POST_GAME = new Set(["results", "leaderboard", "tiernight-end"]);

describe("postGameFallbackTarget - décision", () => {
  it("encore sur l'écran du jeu → résultats", () => {
    assert.equal(
      postGameFallbackTarget("results", { from: "clutch", current: "clutch", postGameScreens: POST_GAME }),
      "results"
    );
  });

  it("déjà sur les résultats → rien", () => {
    assert.equal(
      postGameFallbackTarget("results", { from: "clutch", current: "results", postGameScreens: POST_GAME }),
      null
    );
  });

  it("navigation faite ailleurs entre-temps (Menu) → rien", () => {
    assert.equal(
      postGameFallbackTarget("results", { from: "clutch", current: "settings", postGameScreens: POST_GAME }),
      null
    );
  });

  it("cible qui n'est pas un écran post-partie → rien", () => {
    assert.equal(
      postGameFallbackTarget("game-select", { from: "clutch", current: "clutch", postGameScreens: POST_GAME }),
      null
    );
  });

  it("sans écran d'origine → rien", () => {
    assert.equal(
      postGameFallbackTarget("results", { from: null, current: "clutch", postGameScreens: POST_GAME }),
      null
    );
  });

  it("fin Tier Night (écran post-partie) → résultats", () => {
    assert.equal(
      postGameFallbackTarget("results", {
        from: "tiernight-end",
        current: "tiernight-end",
        postGameScreens: POST_GAME,
      }),
      "results"
    );
  });
});

describe("ensurePostGameScreen - branchement", () => {
  it("gameSync s'appuie sur la décision pure et POST_GAME_SCREENS", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /export function ensurePostGameScreen\(/);
    assert.match(sync, /postGameFallbackTarget\(screen, \{[\s\S]*?postGameScreens: POST_GAME_SCREENS/);
    assert.match(sync, /post_game_route_fallback/);
  });

  const WIRED = [
    ["js/games/clutch.js", "clutch", "clutch"],
    ["js/games/guessLie.js", "guesslie", "guesslie"],
    ["js/games/speedVote.js", "speedvote", "speedvote"],
    ["js/games/wrongAnswer.js", "wronganswer", "wronganswer"],
    ["js/games/hotTake.js", "hottake", "hottake"],
    ["js/games/dilemma.js", "dilemma", "dilemma"],
    ["js/games/trivia.js", "trivia", "trivia"],
    ["js/games/consensus.js", "consensus", "consensus"],
    ["js/screens/tierNightEnd.js", "tiernight", "tiernight-end"],
  ];

  for (const [file, gameId, from] of WIRED) {
    it(`${file} : filet juste après completeGameSession(results), avant le catch`, () => {
      const src = read(file);
      const call = src.indexOf("completeGameSession(");
      assert.ok(call > 0, "appel completeGameSession présent");
      const catchAt = src.indexOf("} catch (e) {", call);
      const segment = src.slice(call, catchAt);
      assert.match(segment, /screen: "results"/);
      assert.match(
        segment,
        new RegExp(`ensurePostGameScreen\\("results", \\{ from: "${from}", gameId: "${gameId}" \\}\\)`)
      );
    });
  }
});
