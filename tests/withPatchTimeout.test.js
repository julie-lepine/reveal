import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SYNC_PATCH_TIMEOUT_MS } from "../js/config/syncConfig.js";
import { withPatchTimeout } from "../js/core/withPatchTimeout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("M-04b / SYN-18 — withPatchTimeout", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("défaut = SYNC_PATCH_TIMEOUT_MS (20s) ; message défaut inchangé", async () => {
    assert.equal(SYNC_PATCH_TIMEOUT_MS, 20000);
    const never = new Promise(() => {});
    const p = withPatchTimeout(never);
    const expectReject = assert.rejects(
      p,
      (err) =>
        err instanceof Error && err.message === "Synchronisation trop longue."
    );
    mock.timers.tick(SYNC_PATCH_TIMEOUT_MS);
    await expectReject;
  });

  it("1 — résolution rapide : résultat, clearTimeout, callback timeout absent après tick", async () => {
    const clearIds = [];
    const realClear = globalThis.clearTimeout;
    globalThis.clearTimeout = (id) => {
      clearIds.push(id);
      return realClear.call(globalThis, id);
    };

    let timeoutFired = false;
    const realSet = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) =>
      realSet.call(
        globalThis,
        (...a) => {
          timeoutFired = true;
          return fn(...a);
        },
        ms,
        ...args
      );

    try {
      const result = await withPatchTimeout(Promise.resolve(42), 5000);
      assert.equal(result, 42);
      assert.equal(clearIds.length, 1, "finally doit clearTimeout une fois");

      mock.timers.tick(10_000);
      await Promise.resolve();
      assert.equal(
        timeoutFired,
        false,
        "callback timeout ne doit pas s'exécuter après clear + avancement horloge"
      );
    } finally {
      globalThis.clearTimeout = realClear;
      globalThis.setTimeout = realSet;
    }
  });

  it("2 — rejet rapide du patch : erreur originale conservée, timer cleared", async () => {
    const clearIds = [];
    const realClear = globalThis.clearTimeout;
    globalThis.clearTimeout = (id) => {
      clearIds.push(id);
      return realClear.call(globalThis, id);
    };

    const original = new Error("échec réseau patch");
    try {
      await assert.rejects(
        withPatchTimeout(Promise.reject(original), 8000),
        (err) => err === original
      );
      assert.equal(clearIds.length, 1);
      mock.timers.tick(8000);
      await Promise.resolve();
    } finally {
      globalThis.clearTimeout = realClear;
    }
  });

  it("3 — timeout réel : message actuel, clear exécuté, promesse réseau non annulée", async () => {
    const clearIds = [];
    const realClear = globalThis.clearTimeout;
    globalThis.clearTimeout = (id) => {
      clearIds.push(id);
      return realClear.call(globalThis, id);
    };

    let underlyingSettled = false;
    let underlyingValue = null;
    const underlying = new Promise((resolve) => {
      setTimeout(() => {
        underlyingSettled = true;
        underlyingValue = "late-ok";
        resolve(underlyingValue);
      }, 5000);
    });

    try {
      const raced = withPatchTimeout(underlying, 1000);
      const expectReject = assert.rejects(
        raced,
        (err) =>
          err instanceof Error &&
          err.message === "Synchronisation trop longue."
      );
      mock.timers.tick(1000);
      await expectReject;

      assert.equal(clearIds.length, 1, "clear après timeout");
      assert.equal(
        underlyingSettled,
        false,
        "la requête sous-jacente n'est pas annulée au timeout"
      );

      mock.timers.tick(4000);
      await underlying;
      assert.equal(underlyingSettled, true);
      assert.equal(underlyingValue, "late-ok");
    } finally {
      globalThis.clearTimeout = realClear;
    }
  });

  it("3b — message custom conservé au timeout", async () => {
    const never = new Promise(() => {});
    const p = withPatchTimeout(never, 200, "Trop long custom.");
    const expectReject = assert.rejects(
      p,
      (err) => err instanceof Error && err.message === "Trop long custom."
    );
    mock.timers.tick(200);
    await expectReject;
  });

  it("4 — ms <= 0 : passthrough, aucun timer créé", async () => {
    let setCount = 0;
    const realSet = globalThis.setTimeout;
    globalThis.setTimeout = (...args) => {
      setCount += 1;
      return realSet.apply(globalThis, args);
    };

    try {
      const input = Promise.resolve("direct");
      assert.equal(await withPatchTimeout(input, 0), "direct");
      assert.equal(await withPatchTimeout(input, -1), "direct");
      assert.equal(setCount, 0);
      assert.equal(withPatchTimeout(input, 0), input);
    } finally {
      globalThis.setTimeout = realSet;
    }
  });

  it("5 — appels parallèles : chaque appel clear son timer, aucun résidu", async () => {
    const clearIds = [];
    const realClear = globalThis.clearTimeout;
    globalThis.clearTimeout = (id) => {
      clearIds.push(id);
      return realClear.call(globalThis, id);
    };

    let timeoutFired = false;
    const realSet = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) =>
      realSet.call(
        globalThis,
        (...a) => {
          timeoutFired = true;
          return fn(...a);
        },
        ms,
        ...args
      );

    try {
      const results = await Promise.all([
        withPatchTimeout(Promise.resolve("a"), 4000),
        withPatchTimeout(Promise.resolve("b"), 4000),
        withPatchTimeout(Promise.resolve("c"), 4000),
      ]);
      assert.deepEqual(results, ["a", "b", "c"]);
      assert.equal(clearIds.length, 3);
      assert.equal(new Set(clearIds).size, 3, "chaque timer a son id");

      mock.timers.tick(10_000);
      await Promise.resolve();
      assert.equal(timeoutFired, false, "aucun callback timeout résiduel");
    } finally {
      globalThis.clearTimeout = realClear;
      globalThis.setTimeout = realSet;
    }
  });
});

describe("M-04b — branchement gameSync", () => {
  it("gameSync réexporte withPatchTimeout depuis le module pur", () => {
    const src = readFileSync(
      join(__dirname, "../js/core/gameSync.js"),
      "utf8"
    );
    assert.match(src, /from ["']\.\/withPatchTimeout\.js["']/);
    assert.match(src, /export \{ withPatchTimeout \}/);
    assert.equal(
      /export function withPatchTimeout/.test(src),
      false,
      "pas de copie locale de withPatchTimeout dans gameSync"
    );
  });
});
