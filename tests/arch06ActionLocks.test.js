import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createActionLock, withClickLock } from "../js/core/actionLock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSrc(rel) {
  return readFileSync(join(__dirname, rel), "utf8");
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Miroir du schéma `executePrepLaunch` / `restartGame` :
 * verrou module + skip silencieux si déjà en vol.
 */
function makeExclusiveAction(lock = createActionLock()) {
  return {
    lock,
    async run(fn) {
      const outcome = await lock.run(fn);
      return outcome.ok ? outcome.value : null;
    },
  };
}

describe("ARCH-06 — createActionLock / withClickLock", () => {
  it("1. double run concurrent → une seule exécution", async () => {
    const lock = createActionLock();
    let calls = 0;
    const gate = deferred();
    const p1 = lock.run(async () => {
      calls += 1;
      await gate.promise;
      return "a";
    });
    const p2 = lock.run(async () => {
      calls += 1;
      return "b";
    });
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(lock.inFlight, true);
    gate.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepEqual(r1, { ok: true, value: "a" });
    assert.deepEqual(r2, { ok: false, skipped: true });
    assert.equal(calls, 1);
    assert.equal(lock.inFlight, false);
  });

  it("2. re-bind (nouveau withClickLock, même lock) pendant await → pas de 2e run", async () => {
    const lock = createActionLock();
    let calls = 0;
    const gate = deferred();
    const body = async () => {
      calls += 1;
      await gate.promise;
    };
    const firstBind = withClickLock(body, { lock });
    const p1 = firstBind({ currentTarget: null });
    await Promise.resolve();
    assert.equal(calls, 1);
    // Simule updatePrepStartSlot / render : nouveau listener, même verrou logique.
    const rebound = withClickLock(body, { lock });
    const p2 = rebound({ currentTarget: null });
    await Promise.resolve();
    assert.equal(calls, 1);
    gate.resolve();
    await Promise.all([p1, p2]);
    assert.equal(calls, 1);
  });

  it("1. lancement exclusif (schéma executePrepLaunch) : double appel → un markStarted", async () => {
    const launch = makeExclusiveAction();
    let calls = 0;
    const gate = deferred();
    const markStarted = async () => {
      calls += 1;
      await gate.promise;
      return { ok: true };
    };
    const p1 = launch.run(markStarted);
    const p2 = launch.run(markStarted);
    await Promise.resolve();
    assert.equal(calls, 1);
    gate.resolve();
    const [a, b] = await Promise.all([p1, p2]);
    assert.deepEqual(a, { ok: true });
    assert.equal(b, null);
    assert.equal(calls, 1);
  });

  it("2. 2e lancement pendant await après « re-bind » (nouveau runner, même lock module)", async () => {
    const lock = createActionLock();
    let calls = 0;
    const gate = deferred();
    const markStarted = async () => {
      calls += 1;
      await gate.promise;
      return { ok: true };
    };
    const first = makeExclusiveAction(lock);
    const p1 = first.run(markStarted);
    await Promise.resolve();
    // Équivalent : nouvel onLaunch rebindé qui rappelle executePrepLaunch (même prepLaunchLock).
    const afterRebind = makeExclusiveAction(lock);
    const p2 = afterRebind.run(markStarted);
    await Promise.resolve();
    assert.equal(calls, 1);
    gate.resolve();
    await Promise.all([p1, p2]);
    assert.equal(calls, 1);
  });

  it("3. double restart concurrent → un seul handler", async () => {
    const restart = makeExclusiveAction();
    let calls = 0;
    const gate = deferred();
    const handlers = {
      hottake: async () => {
        calls += 1;
        await gate.promise;
        return "done";
      },
    };
    async function restartGame(gameId) {
      const fn = handlers[gameId];
      if (!fn) return;
      return restart.run(fn);
    }
    const p1 = restartGame("hottake");
    const p2 = restartGame("hottake");
    await Promise.resolve();
    assert.equal(calls, 1);
    gate.resolve();
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a, "done");
    assert.equal(b, null);
    assert.equal(calls, 1);
  });

  it("4. transition suivante (schéma playlistGuess / tierNightLive) : une seule exécution", async () => {
    const nextRoundLock = createActionLock();
    let transitions = 0;
    const gate = deferred();
    async function nextRound() {
      transitions += 1;
      await gate.promise;
    }
    const click1 = withClickLock(() => nextRound(), { lock: nextRoundLock });
    const p1 = click1({ currentTarget: null });
    await Promise.resolve();
    const click2 = withClickLock(() => nextRound(), { lock: nextRoundLock });
    const p2 = click2({ currentTarget: null });
    await Promise.resolve();
    assert.equal(transitions, 1);
    gate.resolve();
    await Promise.all([p1, p2]);
    assert.equal(transitions, 1);
  });

  it("5. après succès, une nouvelle tentative volontaire reste possible", async () => {
    const lock = createActionLock();
    assert.deepEqual(await lock.run(async () => 1), { ok: true, value: 1 });
    assert.deepEqual(await lock.run(async () => 2), { ok: true, value: 2 });
  });

  it("5+6. après rejet, le lock est libéré et une nouvelle tentative réussit", async () => {
    const exclusive = makeExclusiveAction();
    let calls = 0;
    let shouldFail = true;
    const action = async () => {
      calls += 1;
      if (shouldFail) throw new Error("boom");
      return "ok";
    };
    await assert.rejects(() => exclusive.run(action), /boom/);
    assert.equal(calls, 1);
    assert.equal(exclusive.lock.inFlight, false);
    shouldFail = false;
    assert.equal(await exclusive.run(action), "ok");
    assert.equal(calls, 2);
  });

  it("6. withClickLock propage le rejet et libère le lock partagé", async () => {
    const lock = createActionLock();
    const failing = withClickLock(async () => {
      throw new Error("click fail");
    }, { lock });
    await assert.rejects(() => failing({ currentTarget: null }), /click fail/);
    assert.equal(lock.inFlight, false);
    let ran = false;
    const ok = withClickLock(async () => {
      ran = true;
      return 42;
    }, { lock });
    assert.equal(await ok({ currentTarget: null }), 42);
    assert.equal(ran, true);
  });
});

describe("ARCH-06 — contrats source (câblage V1)", () => {
  it("executePrepLaunch : prepLaunchLock logique (pas seulement DOM)", () => {
    const src = readSrc("../js/core/prepLaunch.js");
    assert.match(src, /import \{ createActionLock \} from "\.\/actionLock\.js"/);
    assert.match(src, /const prepLaunchLock = createActionLock\(\)/);
    assert.match(src, /prepLaunchLock\.run/);
    assert.match(src, /outcome\.ok \? outcome\.value : null/);
  });

  it("bindPrepLaunchButtons documente le verrou dans executePrepLaunch", () => {
    const src = readSrc("../js/core/prepScreen.js");
    assert.match(src, /exclusivité anti double-lancement est dans `executePrepLaunch`/);
  });

  it("restartGame : restartLock logique + bind sans verrou DOM seul", () => {
    const src = readSrc("../js/core/restartGame.js");
    assert.match(src, /const restartLock = createActionLock\(\)/);
    assert.match(src, /restartLock\.run/);
    assert.match(src, /void restartGame\(id\)/);
    assert.match(src, /L'exclusivité est dans `restartGame`/);
  });

  it("4. playlistGuess : nextRound + forceReveal via withClickLock + lock partagé", () => {
    const src = readSrc("../js/games/playlistGuess.js");
    assert.match(src, /const nextRoundLock = createActionLock\(\)/);
    assert.match(src, /const forceRevealLock = createActionLock\(\)/);
    assert.match(
      src,
      /withClickLock\(\s*\(\)\s*=>\s*nextRound\(\)\s*,\s*\{\s*lock:\s*nextRoundLock\s*\}\)/
    );
    assert.match(
      src,
      /withClickLock\(\s*\(\)\s*=>\s*forceReveal\(\)\s*,\s*\{\s*lock:\s*forceRevealLock\s*\}\)/
    );
  });

  it("4. tierNightLive : nextRound via withClickLock + lock partagé", () => {
    const src = readSrc("../js/games/tierNightLive.js");
    assert.match(src, /const nextRoundLock = createActionLock\(\)/);
    assert.match(
      src,
      /withClickLock\(\s*\(\)\s*=>\s*nextRound\(\)\s*,\s*\{\s*lock:\s*nextRoundLock\s*\}\)/
    );
  });
});
