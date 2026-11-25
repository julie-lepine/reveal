/**
 * Audit mise à jour n°5 — un double appui sur une tuile du menu des jeux
 * ne lance qu'une partie (même verrou que « Recommencer » et la roulette).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runExclusiveGameLaunch } from "../js/core/restartGame.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("runExclusiveGameLaunch", () => {
  it("un second lancement pendant le premier est ignoré", async () => {
    let calls = 0;
    let release;
    const slow = () =>
      new Promise((resolve) => {
        calls += 1;
        release = () => resolve("lancé");
      });
    const p1 = runExclusiveGameLaunch(slow);
    const p2 = runExclusiveGameLaunch(slow);
    assert.equal(await p2, undefined);
    release();
    assert.equal(await p1, "lancé");
    assert.equal(calls, 1);
  });

  it("le verrou est libéré après un échec", async () => {
    await assert.rejects(
      runExclusiveGameLaunch(async () => {
        throw new Error("boom");
      })
    );
    assert.equal(await runExclusiveGameLaunch(async () => "ok"), "ok");
  });
});

describe("menu des jeux", () => {
  it("chaque tuile passe par le verrou de lancement", () => {
    const src = readFileSync(join(ROOT, "js/screens/gameSelect.js"), "utf8");
    assert.match(src, /\(\) => runExclusiveGameLaunch\(fn\)/);
    assert.match(src, /const navHandlers = buildGameSelectHandlers\(\)/);
  });
});
