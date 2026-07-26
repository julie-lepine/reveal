import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMountGuard,
  advanceMountGeneration,
  getMountGenerationForTests,
  resetMountGenerationForTests,
  rejectIfStaleMount,
} from "../js/core/mountLifecycle.js";

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

  it("playlistGuess nextRound recheck mount après await", () => {
    const s = readSrc("../js/games/playlistGuess.js");
    assert.match(s, /await startPlaylistGuessRound\(next\)/);
    assert.match(
      s,
      /if \(mp\) \{\s*await startPlaylistGuessRound\(next\);\s*\}\s*if \(!mount\.isMounted\(\)\) return;\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.match(
      s,
      /console\.warn\("REVEAL completeGameSession:", e\);\s*if \(!mount\.isMounted\(\)\) return;\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
  });
});

describe("ARCH-06 Vague B2 — timers / RAF + contrats", () => {
  it("timeout déjà programmé puis dispose → aucun effet", async () => {
    const mount = createMountGuard();
    let ran = 0;
    const id = setTimeout(() => {
      if (!mount.isMounted()) return;
      ran += 1;
    }, 20);
    mount.dispose();
    await new Promise((r) => setTimeout(r, 40));
    clearTimeout(id);
    assert.equal(ran, 0);
  });

  it("timeout normal tant que monté", async () => {
    const mount = createMountGuard();
    let ran = 0;
    await new Promise((resolve) => {
      setTimeout(() => {
        if (!mount.isMounted()) return;
        ran += 1;
        resolve();
      }, 5);
    });
    assert.equal(ran, 1);
    mount.dispose();
  });

  it("RAF déjà programmé puis dispose → aucune mutation ni frame suivante", async () => {
    const mount = createMountGuard();
    let mutations = 0;
    let nextFrames = 0;
    let rafId = 0;
    const queue = [];

    const requestAnimationFrame = (fn) => {
      rafId += 1;
      queue.push({ id: rafId, fn });
      return rafId;
    };
    const cancelAnimationFrame = (id) => {
      const idx = queue.findIndex((x) => x.id === id);
      if (idx >= 0) queue.splice(idx, 1);
    };

    const tick = () => {
      if (!mount.isMounted()) {
        cancelAnimationFrame(rafId);
        return;
      }
      mutations += 1;
      rafId = requestAnimationFrame(tick);
      nextFrames += 1;
    };

    rafId = requestAnimationFrame(tick);
    mount.dispose();
    // Exécute la frame déjà en file (comme un browser après cleanup)
    while (queue.length) {
      const job = queue.shift();
      job.fn(0);
    }
    assert.equal(mutations, 0);
    assert.equal(nextFrames, 0);
    assert.equal(queue.length, 0);
  });

  it("RAF boucle tant que monté, stoppe au dispose sans reprogrammer", async () => {
    const mount = createMountGuard();
    let mutations = 0;
    const queue = [];
    let seq = 0;
    const requestAnimationFrame = (fn) => {
      seq += 1;
      queue.push({ id: seq, fn });
      return seq;
    };

    const tick = () => {
      if (!mount.isMounted()) return;
      mutations += 1;
      if (mutations < 3) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    while (queue.length && mutations < 3) {
      const job = queue.shift();
      job.fn(0);
    }
    assert.equal(mutations, 3);
    mount.dispose();
    requestAnimationFrame(tick);
    while (queue.length) {
      const job = queue.shift();
      job.fn(0);
    }
    assert.equal(mutations, 3);
  });

  it("commit serveur déjà parti termine ; mount mort reste silencieux", async () => {
    const mount = createMountGuard();
    let commitDone = false;
    let ui = 0;
    const gate = deferred();
    const p = (async () => {
      await gate.promise;
      commitDone = true;
      if (!mount.isMounted()) return;
      ui += 1;
    })();
    mount.dispose();
    gate.resolve();
    await p;
    assert.equal(commitDone, true);
    assert.equal(ui, 0);
  });

  it("rejet après cleanup : pas d'unhandled, pas de feedback", async () => {
    const mount = createMountGuard();
    let feedback = 0;
    const gate = deferred();
    const p = (async () => {
      try {
        await gate.promise;
        throw new Error("boom");
      } catch {
        if (!mount.isMounted()) return;
        feedback += 1;
      }
    })();
    mount.dispose();
    gate.resolve();
    await p;
    assert.equal(feedback, 0);
  });

  it("void asyncFn listener : garde après await", async () => {
    const mount = createMountGuard();
    let ui = 0;
    const gate = deferred();
    void (async () => {
      await gate.promise;
      if (!mount.isMounted()) return;
      ui += 1;
    })();
    mount.dispose();
    gate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(ui, 0);
  });

  for (const file of [
    "../js/games/consensus.js",
    "../js/games/trivia.js",
    "../js/games/clutch.js",
    "../js/games/truthMeter.js",
  ]) {
    it(`${file} : createMountGuard + dispose en tête + render gate`, () => {
      const s = readSrc(file);
      assert.match(s, /createMountGuard/);
      assert.match(s, /return \(\) => \{\s*\n\s*mount\.dispose\(\);/s);
      assert.match(s, /function render\(\) \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;/);
    });
  }

  it("consensus : NPC timeout + reveal-pending + scheduleRender vérifient le guard", () => {
    const s = readSrc("../js/games/consensus.js");
    assert.match(s, /const timeoutId = setTimeout\(async \(\) => \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;/s);
    assert.match(s, /revealPendingTimeoutId = setTimeout\(\(\) => \{\s*\n\s*revealPendingTimeoutId = null;\s*\n\s*if \(!mount\.isMounted\(\)\) return;/s);
    assert.match(s, /renderTimer = setTimeout\(\(\) => \{\s*\n\s*renderTimer = null;\s*\n\s*if \(!mount\.isMounted\(\)\) return;/s);
  });

  it("trivia : NPC timeout vérifie le guard avant et après commit", () => {
    const s = readSrc("../js/games/trivia.js");
    assert.match(
      s,
      /const timeoutId = setTimeout\(async \(\) => \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;[\s\S]*?await trivia\.commitPlay\([\s\S]*?if \(!mount\.isMounted\(\)\) return;/
    );
  });

  it("clutch : tick clock/countdown + grace + copyTimer vérifient le guard", () => {
    const s = readSrc("../js/games/clutch.js");
    assert.match(
      s,
      /const tick = \(\) => \{\s*\n\s*if \(!mount\.isMounted\(\) \|\| !mount\.isCurrentMount\(\)\) \{\s*\n\s*stopClock\(\);\s*\n\s*return;/s
    );
    assert.match(
      s,
      /function onGraceElapsed\(\) \{\s*\n\s*graceTimer = null;\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.match(
      s,
      /copyTimer = setInterval\(\(\) => \{\s*\n\s*if \(!mount\.isMounted\(\) \|\| !mount\.isCurrentMount\(\)\) \{/s
    );
  });

  it("truthMeter : step RAF + reveal-pending + display timeouts vérifient le guard", () => {
    const s = readSrc("../js/games/truthMeter.js");
    assert.match(
      s,
      /const step = \(now\) => \{\s*\n\s*if \(!mount\.isMounted\(\) \|\| !mount\.isCurrentMount\(\)\) \{\s*\n\s*revealAnimId = null;\s*\n\s*return;/s
    );
    assert.match(
      s,
      /revealPendingTimeoutId = setTimeout\(\(\) => \{\s*\n\s*revealPendingTimeoutId = null;\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.match(
      s,
      /displayTimeoutId = setTimeout\(\(\) => \{\s*\n\s*displayTimeoutId = null;\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
  });
});

describe("ARCH-06 Vague B3 — tierNightLive mountMp", () => {
  function simulateTierLiveMpMount() {
    const mount = createMountGuard();
    const effects = {
      renders: 0,
      navigates: 0,
      commitsStarted: 0,
      commitsFinished: 0,
      sessionEffects: 0,
      feedback: 0,
    };

    async function transitionToReveal({ gate } = {}) {
      effects.commitsStarted += 1;
      await (gate ? gate.promise : Promise.resolve());
      effects.commitsFinished += 1;
      if (!mount.isMounted()) return { uiApplied: false };
      effects.renders += 1;
      return { uiApplied: true };
    }

    async function nextRound({ last = false, gate, fail = false } = {}) {
      effects.commitsStarted += 1;
      try {
        await (gate ? gate.promise : Promise.resolve());
        if (fail) throw new Error("finalize fail");
        effects.commitsFinished += 1;
      } catch (err) {
        if (!mount.isMounted()) return { uiApplied: false, err };
        effects.feedback += 1;
        throw err;
      }
      if (!mount.isMounted()) return { uiApplied: false };
      if (last) effects.navigates += 1;
      else effects.renders += 1;
      return { uiApplied: true };
    }

    function onGameSessionChange(handler) {
      if (!mount.isMounted()) return;
      handler();
    }

    return {
      mount,
      effects,
      transitionToReveal,
      nextRound,
      onGameSessionChange,
      cleanup() {
        mount.dispose();
      },
    };
  }

  it("reveal qui termine après unmount → aucun render", async () => {
    const screen = simulateTierLiveMpMount();
    const gate = deferred();
    const p = screen.transitionToReveal({ gate });
    screen.cleanup();
    gate.resolve();
    const out = await p;
    assert.equal(out.uiApplied, false);
    assert.equal(screen.effects.commitsFinished, 1);
    assert.equal(screen.effects.renders, 0);
  });

  it("next qui termine après unmount → aucune navigation", async () => {
    const screen = simulateTierLiveMpMount();
    const gate = deferred();
    const p = screen.nextRound({ last: true, gate });
    screen.cleanup();
    gate.resolve();
    const out = await p;
    assert.equal(out.uiApplied, false);
    assert.equal(screen.effects.commitsFinished, 1);
    assert.equal(screen.effects.navigates, 0);
  });

  it("onGameSessionChange après dispose → aucun effet différé", async () => {
    const screen = simulateTierLiveMpMount();
    const gate = deferred();
    screen.onGameSessionChange(() => {
      void (async () => {
        await gate.promise;
        if (!screen.mount.isMounted()) return;
        screen.effects.sessionEffects += 1;
        screen.effects.renders += 1;
        screen.effects.navigates += 1;
      })();
    });
    screen.cleanup();
    // Listener déjà lancé avant dispose : la garde dans l'async bloque.
    gate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(screen.effects.sessionEffects, 0);
    assert.equal(screen.effects.renders, 0);
    assert.equal(screen.effects.navigates, 0);

    // Callback synchrone après dispose : court-circuité.
    screen.onGameSessionChange(() => {
      screen.effects.sessionEffects += 1;
    });
    assert.equal(screen.effects.sessionEffects, 0);
  });

  it("commit déjà parti termine ; mount mort silencieux", async () => {
    const screen = simulateTierLiveMpMount();
    const gate = deferred();
    const p = screen.transitionToReveal({ gate });
    assert.equal(screen.effects.commitsStarted, 1);
    screen.cleanup();
    gate.resolve();
    await p;
    assert.equal(screen.effects.commitsFinished, 1);
    assert.equal(screen.effects.renders, 0);
  });

  it("rejet après unmount : pas d'unhandled ni feedback", async () => {
    const screen = simulateTierLiveMpMount();
    const gate = deferred();
    const p = screen.nextRound({ last: true, gate, fail: true });
    screen.cleanup();
    gate.resolve();
    const out = await p;
    assert.equal(out.uiApplied, false);
    assert.equal(screen.effects.feedback, 0);
    assert.equal(screen.effects.navigates, 0);
  });

  it("nouveau mount fonctionne normalement", async () => {
    const oldScreen = simulateTierLiveMpMount();
    const gate = deferred();
    const stale = oldScreen.transitionToReveal({ gate });
    oldScreen.cleanup();

    const fresh = simulateTierLiveMpMount();
    const ok = await fresh.transitionToReveal();
    assert.equal(ok.uiApplied, true);
    assert.equal(fresh.effects.renders, 1);

    const nextOk = await fresh.nextRound({ last: true });
    assert.equal(nextOk.uiApplied, true);
    assert.equal(fresh.effects.navigates, 1);

    gate.resolve();
    await stale;
    assert.equal(oldScreen.effects.renders, 0);
  });

  it("tierNightLive mountMp : createMountGuard + dispose + gates reveal/next/session", () => {
    const s = readSrc("../js/games/tierNightLive.js");
    assert.match(s, /function mountMp[\s\S]*createMountGuard\(\)/);
    assert.match(s, /return \(\) => \{\s*\n\s*mount\.dispose\(\);\s*\n\s*unsub\(\);/s);
    assert.match(s, /function render\(\) \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;/);
    assert.match(
      s,
      /await commitTierNightLivePlay\(\{ phase: "reveal", placements \}\);\s*\n\s*if \(!mount\.isMounted\(\)\) return;/s
    );
    assert.match(
      s,
      /await commitTierNightLivePlay\(tierNightLiveVotingPayload\(session\.roundIdx \+ 1\)\);\s*\n\s*if \(!mount\.isMounted\(\)\) return;/s
    );
    assert.match(
      s,
      /await finalizeTierNightLiveToResults\(\{\s*shouldContinue: \(\) => mount\.isMounted\(\) && mount\.isCurrentMount\(\),\s*\}\)/s
    );
    assert.match(s, /const unsub = onGameSessionChange\(\(row\) => \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s);
    // Solo inchangé : pas de createMountGuard dans mountSolo
    const solo = s.slice(s.indexOf("function mountSolo"), s.indexOf("function mountMp"));
    assert.equal(/createMountGuard/.test(solo), false);
  });

  it("finalizeTierNightLiveToResults : shouldContinue gate navigate après patch", () => {
    const s = readSrc("../js/core/gameSync.js");
    assert.match(
      s,
      /export async function finalizeTierNightLiveToResults\(\{ shouldContinue = null \} = \{\}\)/
    );
    assert.match(
      s,
      /const row = await patchGameState\([\s\S]*?if \(!canContinue\(\)\) return false;\s*\n\s*if \(getEffectiveSessionScreen\(row\) !== "tiernight-end"\) return false;\s*\n\s*navigate\("tiernight-end"\)/s
    );
  });
});

describe("ARCH-06 Vague C0 — génération + isCurrentMount (transparent)", () => {
  it("isCurrentMount true tant que génération stable et pas disposé", () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const g = createMountGuard();
    assert.equal(g.isMounted(), true);
    assert.equal(g.isCurrentMount(), true);
    assert.equal(typeof g.generation, "undefined");
  });

  it("dispose : isMounted et isCurrentMount false", () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const g = createMountGuard();
    g.dispose();
    assert.equal(g.isMounted(), false);
    assert.equal(g.isCurrentMount(), false);
  });

  it("advance sans dispose : isMounted true, isCurrentMount false", () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const g = createMountGuard();
    advanceMountGeneration();
    assert.equal(g.isMounted(), true);
    assert.equal(g.isCurrentMount(), false);
  });

  it("rejectIfStaleMount distingue dispose vs génération", () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const disposed = createMountGuard();
    disposed.dispose();
    assert.equal(rejectIfStaleMount(disposed), true);

    const staleGen = createMountGuard();
    advanceMountGeneration();
    assert.equal(staleGen.isMounted(), true);
    assert.equal(rejectIfStaleMount(staleGen), true);

    const current = createMountGuard();
    assert.equal(rejectIfStaleMount(current), false);
  });

  it("remount same-screen via advance : ancien silencieux, nouveau courant", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = createMountGuard();
    const gate = deferred();
    let aUi = 0;
    let bUi = 0;
    const p = (async () => {
      await gate.promise;
      if (!a.isMounted()) return;
      if (!a.isCurrentMount()) return;
      aUi += 1;
    })();
    advanceMountGeneration();
    const b = createMountGuard();
    assert.equal(a.isCurrentMount(), false);
    assert.equal(b.isCurrentMount(), true);
    if (!b.isMounted()) throw new Error("b should be mounted");
    if (!b.isCurrentMount()) throw new Error("b should be current");
    bUi += 1;
    gate.resolve();
    await p;
    assert.equal(aUi, 0);
    assert.equal(bUi, 1);
  });

  it("plusieurs remounts : seule la dernière génération est courante", () => {
    resetMountGenerationForTests();
    const guards = [];
    for (let i = 0; i < 5; i += 1) {
      advanceMountGeneration();
      guards.push(createMountGuard());
    }
    guards.forEach((g, i) => {
      assert.equal(g.isCurrentMount(), i === guards.length - 1);
    });
  });

  it("API publique : pas de .generation sur le guard", () => {
    const g = createMountGuard();
    assert.equal("generation" in g, false);
    assert.equal(typeof getMountGenerationForTests(), "number");
  });
});

describe("ARCH-06 Vague C1 — contrats double garde périmètre B", () => {
  for (const file of [
    "../js/games/hotTake.js",
    "../js/games/wrongAnswer.js",
    "../js/games/guessLie.js",
    "../js/games/speedVote.js",
    "../js/games/consensus.js",
    "../js/games/trivia.js",
    "../js/games/clutch.js",
    "../js/games/truthMeter.js",
    "../js/games/tierNightLive.js",
    "../js/games/playlistGuess.js",
  ]) {
    it(`${file} : double-garde isMounted + isCurrentMount sur chemins session`, () => {
      const s = readSrc(file);
      assert.match(s, /createMountGuard/);
      assert.match(
        s,
        /if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
      );
    });
  }

  it("rejectIfStaleMount disponible sans être requis dans les jeux", () => {
    assert.equal(typeof rejectIfStaleMount, "function");
  });
});

describe("ARCH-06 Vague C2 — shouldContinue helpers", () => {
  it("shouldContinue false après await → pas de navigate ; défaut true sans callback", async () => {
    let navigates = 0;
    let commits = 0;
    async function fakeFinalize({ shouldContinue = null } = {}) {
      const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();
      commits += 1;
      await Promise.resolve();
      if (!canContinue()) return false;
      navigates += 1;
      return true;
    }
    assert.equal(await fakeFinalize(), true);
    assert.equal(navigates, 1);
    navigates = 0;
    assert.equal(await fakeFinalize({ shouldContinue: () => false }), false);
    assert.equal(navigates, 0);
    assert.equal(commits, 2);
  });
});
