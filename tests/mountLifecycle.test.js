import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMountGuard } from "../js/core/mountLifecycle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSrc(rel) {
  return readFileSync(join(__dirname, rel), "utf8");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Miroir minimal d'un mount jeu : commit serveur + effets UI/nav après await.
 */
function simulateGameMount() {
  const mount = createMountGuard();
  const effects = {
    renders: 0,
    binds: 0,
    navigates: 0,
    localUiMutations: 0,
    commitsStarted: 0,
    commitsFinished: 0,
  };

  async function runAction({ fail = false, gate } = {}) {
    effects.commitsStarted += 1;
    try {
      if (gate) await gate.promise;
      else await Promise.resolve();
      if (fail) throw new Error("network fail");
      effects.commitsFinished += 1;
    } catch (err) {
      // Erreur consommée comme dans les jeux (pas d'unhandled).
      if (!mount.isMounted()) return { ok: false, err, uiApplied: false };
      effects.localUiMutations += 1; // feedback ancien écran seulement si monté
      throw err;
    }
    if (!mount.isMounted()) return { ok: true, uiApplied: false };
    effects.renders += 1;
    effects.binds += 1;
    effects.localUiMutations += 1;
    effects.navigates += 1;
    return { ok: true, uiApplied: true };
  }

  /** void asyncFn() depuis un listener session — se protège après await. */
  function onSessionChange(asyncFn) {
    if (!mount.isMounted()) return;
    void asyncFn().catch(() => {});
  }

  return {
    mount,
    effects,
    runAction,
    onSessionChange,
    cleanup() {
      mount.dispose();
    },
  };
}

describe("ARCH-06 Vague B0 — createMountGuard", () => {
  it("isMounted true jusqu'à dispose", () => {
    const g = createMountGuard();
    assert.equal(g.isMounted(), true);
    assert.equal(g.alive, true);
    g.dispose();
    assert.equal(g.isMounted(), false);
    assert.equal(g.alive, false);
  });

  it("async après cleanup : aucun render / bind / navigate / mutation UI", async () => {
    const screen = simulateGameMount();
    const gate = deferred();
    const p = screen.runAction({ gate });
    screen.cleanup();
    gate.resolve();
    const out = await p;
    assert.equal(out.ok, true);
    assert.equal(out.uiApplied, false);
    assert.equal(screen.effects.commitsStarted, 1);
    assert.equal(screen.effects.commitsFinished, 1);
    assert.equal(screen.effects.renders, 0);
    assert.equal(screen.effects.binds, 0);
    assert.equal(screen.effects.navigates, 0);
    assert.equal(screen.effects.localUiMutations, 0);
  });

  it("commit déjà parti n'est pas annulé artificiellement", async () => {
    const screen = simulateGameMount();
    const gate = deferred();
    const p = screen.runAction({ gate });
    assert.equal(screen.effects.commitsStarted, 1);
    screen.cleanup();
    gate.resolve();
    await p;
    assert.equal(screen.effects.commitsFinished, 1);
  });

  it("rejet async (fail après await) après unmount : pas de mutation UI", async () => {
    const screen = simulateGameMount();
    const gate = deferred();
    const p = screen.runAction({ gate, fail: true });
    screen.cleanup();
    gate.resolve();
    const out = await p;
    assert.equal(out.ok, false);
    assert.equal(out.uiApplied, false);
    assert.equal(screen.effects.localUiMutations, 0);
    assert.equal(screen.effects.renders, 0);
  });

  it("rejet async pendant mount : peut appliquer feedback local puis propager si voulu", async () => {
    const screen = simulateGameMount();
    await assert.rejects(() => screen.runAction({ fail: true }), /network fail/);
    assert.equal(screen.effects.localUiMutations, 1);
  });

  it("nouveau mount reste fonctionnel après cleanup de l'ancien", async () => {
    const oldScreen = simulateGameMount();
    const gate = deferred();
    const stale = oldScreen.runAction({ gate });
    oldScreen.cleanup();

    const newScreen = simulateGameMount();
    const fresh = await newScreen.runAction();
    assert.equal(fresh.uiApplied, true);
    assert.equal(newScreen.effects.renders, 1);
    assert.equal(newScreen.effects.navigates, 1);

    gate.resolve();
    await stale;
    assert.equal(oldScreen.effects.renders, 0);
  });

  it("void asyncFn depuis listener : se protège après await", async () => {
    const screen = simulateGameMount();
    const gate = deferred();
    let uiAfter = false;
    screen.onSessionChange(async () => {
      await gate.promise;
      if (!screen.mount.isMounted()) return;
      uiAfter = true;
      screen.effects.renders += 1;
    });
    screen.cleanup();
    gate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(uiAfter, false);
    assert.equal(screen.effects.renders, 0);
  });

  it("B4 schéma playlistGuess nextRound : pas de render/navigate après unmount", async () => {
    const mount = createMountGuard();
    let renders = 0;
    let navigates = 0;
    const gate = deferred();

    async function nextRound({ last = false } = {}) {
      if (!mount.isMounted()) return;
      if (last) {
        try {
          await gate.promise;
        } catch {
          if (!mount.isMounted()) return;
          navigates += 1;
          return;
        }
        return;
      }
      await gate.promise;
      if (!mount.isMounted()) return;
      renders += 1;
    }

    const mid = nextRound();
    mount.dispose();
    gate.resolve();
    await mid;
    assert.equal(renders, 0);

    const mount2 = createMountGuard();
    const gate2 = deferred();
    let nav = 0;
    async function nextRoundLastFail() {
      try {
        await gate2.promise;
        throw new Error("complete fail");
      } catch {
        if (!mount2.isMounted()) return;
        nav += 1;
      }
    }
    const p = nextRoundLastFail();
    mount2.dispose();
    gate2.resolve();
    await p;
    assert.equal(nav, 0);
  });
});

describe("ARCH-06 Vague B1 — contrats câblage", () => {
  for (const file of [
    "../js/games/hotTake.js",
    "../js/games/wrongAnswer.js",
    "../js/games/guessLie.js",
    "../js/games/speedVote.js",
  ]) {
    it(`${file} : createMountGuard + dispose + render gate`, () => {
      const s = readSrc(file);
      assert.match(s, /createMountGuard/);
      assert.match(s, /mount\.dispose\(\)/);
      assert.match(s, /if \(!mount\.isMounted\(\)\) return;/);
      assert.match(s, /function render\(\) \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;/);
    });
  }

  it("playlistGuess nextRound recheck unmounted après await", () => {
    const s = readSrc("../js/games/playlistGuess.js");
    assert.match(s, /await startPlaylistGuessRound\(next\)/);
    assert.match(s, /if \(mp\) \{\s*await startPlaylistGuessRound\(next\);\s*\}\s*if \(unmounted\) return;/s);
    assert.match(
      s,
      /console\.warn\("REVEAL completeGameSession:", e\);\s*if \(unmounted\) return;/s
    );
  });
});
