import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  advanceMountGeneration,
  createMountGuard,
  resetMountGenerationForTests,
} from "../js/core/mountLifecycle.js";

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
 * Miroir du bootstrap IIFE mountLobby + listeners session/bundle.
 */
function simulateLobbyMount() {
  const mount = createMountGuard();
  const shouldContinue = () => mount.isMounted() && mount.isCurrentMount();
  const effects = {
    renders: 0,
    navigates: 0,
    binds: 0,
    feedbacks: 0,
    subscribes: 0,
    unsubscribes: 0,
    listenerHandled: 0,
    bootstrapDone: 0,
  };
  const listeners = [];

  function renderFull() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.renders += 1;
    effects.binds += 1;
  }

  function navigate() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.navigates += 1;
  }

  function feedback() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.feedbacks += 1;
  }

  function subscribe(fn) {
    effects.subscribes += 1;
    listeners.push(fn);
    return () => {
      effects.unsubscribes += 1;
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  async function bootstrap({ gate, eveningRedirect = false } = {}) {
    if (gate) await gate.promise;
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.bootstrapDone += 1;
    if (eveningRedirect) {
      navigate();
      return;
    }
    renderFull();
    const unsub = subscribe(async (payload) => {
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      effects.listenerHandled += 1;
      if (payload?.awaitable) {
        await payload.awaitable;
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
      }
      if (payload?.route) navigate();
      else renderFull();
    });
    return unsub;
  }

  async function routeHelper({ shouldContinue: sc = null, afterAwait } = {}) {
    const canContinue = () => typeof sc !== "function" || sc();
    await Promise.resolve();
    if (!canContinue()) return false;
    if (afterAwait) await afterAwait();
    if (!canContinue()) return false;
    effects.navigates += 1;
    return true;
  }

  function cleanup(unsub) {
    mount.dispose();
    if (typeof unsub === "function") unsub();
  }

  return {
    mount,
    shouldContinue,
    effects,
    listeners,
    bootstrap,
    routeHelper,
    cleanup,
    fireListeners(payload) {
      return Promise.all(listeners.map((fn) => fn(payload)));
    },
  };
}

describe("ARCH-06 Lobby IIFE / SYN-12 — lifecycle", () => {
  it("ancien bootstrap terminé après remount → aucun render / bind / subscribe", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = simulateLobbyMount();
    const gate = deferred();
    const p = a.bootstrap({ gate });
    advanceMountGeneration();
    const b = simulateLobbyMount();
    a.cleanup();
    const unsubB = await b.bootstrap();
    gate.resolve();
    await p;
    assert.equal(a.effects.bootstrapDone, 0);
    assert.equal(a.effects.renders, 0);
    assert.equal(a.effects.binds, 0);
    assert.equal(a.effects.subscribes, 0);
    assert.equal(b.effects.bootstrapDone, 1);
    assert.equal(b.effects.renders, 1);
    assert.equal(b.effects.subscribes, 1);
    b.cleanup(unsubB);
  });

  it("ancien bootstrap terminé après navigation → aucun navigate fantôme", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = simulateLobbyMount();
    const gate = deferred();
    const p = a.bootstrap({ gate, eveningRedirect: true });
    a.cleanup();
    gate.resolve();
    await p;
    assert.equal(a.effects.navigates, 0);
    assert.equal(a.effects.bootstrapDone, 0);
  });

  it("ancien listener après dispose → silencieux", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = simulateLobbyMount();
    const unsub = await a.bootstrap();
    const retained = [...a.listeners];
    a.cleanup(unsub);
    assert.equal(a.effects.unsubscribes, 1);
    assert.equal(a.listeners.length, 0);
    // Appel fantôme (fuite hypothétique) : garde mount bloque
    for (const fn of retained) {
      await fn({ route: true });
    }
    assert.equal(a.effects.listenerHandled, 0);
    assert.equal(a.effects.navigates, 0);
  });

  it("ancien render / navigate ignorés ; nouvelle instance OK", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = simulateLobbyMount();
    const unsubA = await a.bootstrap();
    advanceMountGeneration();
    const b = simulateLobbyMount();
    a.cleanup(unsubA);
    const unsubB = await b.bootstrap();
    await a.fireListeners({ route: true });
    await b.fireListeners({ route: true });
    assert.equal(a.effects.navigates, 0);
    assert.equal(b.effects.navigates, 1);
    assert.equal(b.effects.listenerHandled, 1);
    b.cleanup(unsubB);
  });

  it("listener async d'ancien mount après remount → aucun effet", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = simulateLobbyMount();
    const unsubA = await a.bootstrap();
    const gate = deferred();
    const pending = a.fireListeners({ awaitable: gate.promise, route: true });
    advanceMountGeneration();
    const b = simulateLobbyMount();
    a.cleanup(unsubA);
    const unsubB = await b.bootstrap();
    gate.resolve();
    await pending;
    assert.equal(a.effects.navigates, 0);
    assert.ok(a.effects.listenerHandled <= 1);
    await b.fireListeners({});
    assert.equal(b.effects.renders >= 2, true);
    b.cleanup(unsubB);
  });
});

describe("ARCH-06 Lobby IIFE — listeners / double subscribe", () => {
  it("un seul subscribe par mount ; unsubscribe au cleanup", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const h = simulateLobbyMount();
    const unsub = await h.bootstrap();
    assert.equal(h.effects.subscribes, 1);
    h.cleanup(unsub);
    assert.equal(h.effects.unsubscribes, 1);
    assert.equal(h.listeners.length, 0);
  });

  it("remounts successifs : pas de double abonnement actif", async () => {
    resetMountGenerationForTests();
    let active = 0;
    const mounts = [];
    for (let i = 0; i < 3; i += 1) {
      advanceMountGeneration();
      const h = simulateLobbyMount();
      const prev = mounts[mounts.length - 1];
      if (prev) {
        prev.cleanup(prev.unsub);
        active -= 1;
      }
      const unsub = await h.bootstrap();
      h.unsub = unsub;
      mounts.push(h);
      active += 1;
      assert.equal(active, 1);
    }
    const last = mounts[mounts.length - 1];
    assert.equal(last.effects.subscribes, 1);
    last.cleanup(last.unsub);
  });
});

describe("ARCH-06 Lobby IIFE — helpers shouldContinue", () => {
  it("shouldContinue=false → aucun effet local post-await", async () => {
    const h = simulateLobbyMount();
    h.mount.dispose();
    const ok = await h.routeHelper({ shouldContinue: h.shouldContinue });
    assert.equal(ok, false);
    assert.equal(h.effects.navigates, 0);
  });

  it("shouldContinue=true → comportement historique (navigate)", async () => {
    const h = simulateLobbyMount();
    const ok = await h.routeHelper({ shouldContinue: h.shouldContinue });
    assert.equal(ok, true);
    assert.equal(h.effects.navigates, 1);
  });

  it("défaut null (call sites historiques) → continue", async () => {
    const h = simulateLobbyMount();
    const ok = await h.routeHelper({});
    assert.equal(ok, true);
    assert.equal(h.effects.navigates, 1);
  });
});

describe("ARCH-06 Lobby IIFE — contrats source", () => {
  const lobbySrc = readSrc("../js/screens/lobby.js");
  const syncSrc = readSrc("../js/core/gameSync.js");
  const resumeSrc = readSrc("../js/core/gameResume.js");

  it("createMountGuard + dispose en tête du cleanup", () => {
    assert.match(lobbySrc, /createMountGuard\(\)/);
    assert.match(
      lobbySrc,
      /return \(\) => \{\s*\n\s*mount\.dispose\(\);/s
    );
    assert.match(
      lobbySrc,
      /if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
  });

  it("IIFE bootstrap : double garde après ensureLobby / refresh / reconcile", () => {
    assert.match(
      lobbySrc,
      /await ensureLobby\(\);\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.match(
      lobbySrc,
      /const row = await refreshGameSession\(\);\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.match(
      lobbySrc,
      /await reconcileLobbyReadyOnMount\(\);\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
  });

  it("listeners session / bundle : double garde + shouldContinue route", () => {
    assert.match(
      lobbySrc,
      /onGameSessionChange\(async \(row\) => \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.match(
      lobbySrc,
      /onLobbyBundleUpdated\(\(\) => \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.match(
      lobbySrc,
      /routeToActiveGameIfNeeded\([^)]*shouldContinue/
    );
    assert.match(
      lobbySrc,
      /mountGameResumeInterstitial\([\s\S]*shouldContinue/s
    );
  });

  it("routeToActiveGameIfNeeded / rejoin : shouldContinue opaque défaut true", () => {
    assert.match(
      syncSrc,
      /export async function routeToActiveGameIfNeeded\(\s*cachedRowOnly = null,\s*\{\s*force = false,\s*shouldContinue = null\s*\} = \{\}\s*\)/s
    );
    assert.match(
      resumeSrc,
      /export async function rejoinGameResumeTarget\(targetScreen, \{ shouldContinue = null \} = \{\}\)/
    );
    assert.match(
      resumeSrc,
      /mountGameResumeInterstitial\([\s\S]*shouldContinue = null/s
    );
  });

  it("locks prêt / lancer soirée ; pas de 4e convention lifecycle", () => {
    assert.match(lobbySrc, /const startEveningLock = createActionLock\(\)/);
    assert.match(lobbySrc, /const readyLock = createActionLock\(\)/);
    assert.match(lobbySrc, /withClickLock\([\s\S]*lock:\s*readyLock/);
    assert.match(lobbySrc, /withClickLock\([\s\S]*lock:\s*startEveningLock/);
    assert.equal(/\blet\s+cancelled\s*=/.test(lobbySrc), false);
    assert.equal(/\blet\s+destroyed\s*=/.test(lobbySrc), false);
    // hasRenderedOnce = chat, pas un flag de vivacité parallèle
    assert.match(lobbySrc, /let hasRenderedOnce = false/);
  });

  it("régression SYN-12 : un seul startMultiplayerSync pre-refresh", () => {
    const start = lobbySrc.indexOf("export function mountLobby");
    const mountSrc = lobbySrc.slice(start);
    assert.equal((mountSrc.match(/startMultiplayerSync\(\)/g) || []).length, 1);
    const idxStart = mountSrc.indexOf("startMultiplayerSync()");
    const idxResume = mountSrc.indexOf('earlyReturn === "resume"');
    assert.ok(idxStart < idxResume);
  });
});
