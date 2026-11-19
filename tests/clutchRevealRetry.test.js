/**
 * Clutch : si l'envoi des résultats de la manche échoue chez l'hôte, il doit être
 * relancé automatiquement (sinon tout le monde reste bloqué sur « Temps écoulé »).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLUTCH_REVEAL_RETRY_MS,
  createClutchRevealRetry,
} from "../js/core/clutchRevealRetry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Faux minuteur : on déclenche les relances à la main. */
function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimer: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => pending.delete(id),
    pending,
    async fireAll() {
      const list = [...pending.entries()];
      pending.clear();
      for (const [, t] of list) t.fn();
      await new Promise((r) => setImmediate(r));
    },
  };
}

function setup({ failTimes = 1, canRetry = () => true } = {}) {
  const timers = fakeTimers();
  const states = [];
  let calls = 0;
  const retry = createClutchRevealRetry({
    attempt: async () => {
      calls += 1;
      if (calls <= failTimes) throw new Error("réseau coupé");
    },
    shouldRetry: canRetry,
    onStateChange: (f) => states.push(f),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { retry, timers, states, calls: () => calls };
}

describe("Clutch : relance de l'envoi des résultats", () => {
  it("échec puis succès : relance au bout de 3 s, message affiché puis retiré", async () => {
    const { retry, timers, states, calls } = setup({ failTimes: 1 });
    await retry.run();
    assert.equal(calls(), 1);
    assert.equal(retry.isFailing(), true);
    assert.equal(timers.pending.size, 1);
    assert.equal([...timers.pending.values()][0].ms, CLUTCH_REVEAL_RETRY_MS);
    assert.equal(CLUTCH_REVEAL_RETRY_MS, 3000);

    await timers.fireAll();
    assert.equal(calls(), 2);
    assert.equal(retry.isFailing(), false);
    assert.equal(timers.pending.size, 0);
    assert.deepEqual(states, [true, false]);
  });

  it("plusieurs échecs : on continue de réessayer", async () => {
    const { retry, timers, calls } = setup({ failTimes: 3 });
    await retry.run();
    await timers.fireAll();
    await timers.fireAll();
    assert.equal(calls(), 3);
    assert.equal(timers.pending.size, 1);
    await timers.fireAll();
    assert.equal(calls(), 4);
    assert.equal(retry.isFailing(), false);
  });

  it("résultats annoncés entre-temps (ou plus hôte) : la relance s'arrête", async () => {
    let still = true;
    const { retry, timers, calls } = setup({ failTimes: 5, canRetry: () => still });
    await retry.run();
    still = false;
    await timers.fireAll();
    assert.equal(calls(), 1);
    assert.equal(timers.pending.size, 0);
    assert.equal(retry.isFailing(), false);
  });

  it("pas de relance si on ne doit plus réessayer dès le premier échec", async () => {
    const { retry, timers } = setup({ failTimes: 1, canRetry: () => false });
    await retry.run();
    assert.equal(timers.pending.size, 0);
    assert.equal(retry.isFailing(), false);
  });

  it("stop() annule la relance (sortie d'écran, nouvelle manche)", async () => {
    const { retry, timers, calls } = setup({ failTimes: 5 });
    await retry.run();
    retry.stop();
    assert.equal(timers.pending.size, 0);
    await timers.fireAll();
    assert.equal(calls(), 1);
  });

  it("run() ne rejette jamais (plus d'erreur perdue)", async () => {
    const { retry } = setup({ failTimes: 1 });
    await assert.doesNotReject(() => retry.run());
  });

  it("l'écran Clutch remet takeScored à faux en cas d'échec et passe par la relance", () => {
    const src = readFileSync(join(__dirname, "../js/games/clutch.js"), "utf8");
    const transition = src.slice(
      src.indexOf("async function transitionToReveal"),
      src.indexOf("const revealRetry")
    );
    assert.match(transition, /catch \(err\) \{[\s\S]*?takeScored = false;[\s\S]*?throw err;/);
    assert.match(src, /async function goToReveal\(\) \{\s*await revealRetry\.run\(\);/);
    assert.match(src, /revealRetrying && \(!mp \|\| canActAsHost\(\)\)\s*\? CLUTCH_REVEAL_RETRY_LABEL/);
  });
});
