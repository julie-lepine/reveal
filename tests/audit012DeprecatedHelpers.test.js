/**
 * AUDIT-012 — helpers deprecated morts retirés ; API de remplacement conservée.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("AUDIT-012 - helpers deprecated retirés", () => {
  it("runWithChatRouletteLaunchBypass absent ; permit conservé", () => {
    const src = read("js/core/restartGame.js");
    assert.equal(src.includes("runWithChatRouletteLaunchBypass"), false);
    assert.match(src, /export async function runWithChatRouletteLaunchPermit/);
  });

  it("setHotTakePausedBy / clearHotTakePause absents ; pause/resume conservés", () => {
    const src = read("js/core/hotTakeSession.js");
    assert.equal(src.includes("setHotTakePausedBy"), false);
    assert.equal(src.includes("clearHotTakePause"), false);
    assert.match(src, /export async function pauseHotTakeVote/);
    assert.match(src, /export async function resumeHotTakeVote/);
  });

  it("aucun import résiduel dans js/ ou tests/", () => {
    // Grep logique : seuls docs audit peuvent encore citer les noms historiques.
    const restartImporters = [
      "js/core/chatRandomGame.js",
      "js/screens/gameSelect.js",
      "js/screens/results.js",
      "js/screens/tierNightEnd.js",
      "js/games/traitre.js",
      "tests/featureChat03RandomGame.test.js",
      "tests/featureChat03RouletteReactions.test.js",
    ];
    for (const rel of restartImporters) {
      const src = read(rel);
      assert.equal(
        src.includes("runWithChatRouletteLaunchBypass"),
        false,
        rel
      );
    }
    const hotTakeTouch = [
      "js/games/hotTake.js",
      "js/screens/hotTakePrep.js",
      "tests/hotTakeVoteCommit.test.js",
      "tests/hotTakeSyncPending.test.js",
      "tests/hotTakePodiumMp.test.js",
    ];
    for (const rel of hotTakeTouch) {
      const src = read(rel);
      assert.equal(src.includes("setHotTakePausedBy"), false, rel);
      assert.equal(src.includes("clearHotTakePause"), false, rel);
    }
  });
});
