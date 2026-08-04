import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createActionLock, withClickLock } from "../js/core/actionLock.js";
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
 * Miroir des actions hôte Traître : lock partagé + garde mount post-await.
 */
function simulateTraitreHostMount() {
  const mount = createMountGuard();
  const finishSpeakLock = createActionLock();
  const continueSpeakLock = createActionLock();
  const startVoteLock = createActionLock();
  const resolveVoteLock = createActionLock();
  const dealAdvanceLock = createActionLock();
  const effects = {
    commits: 0,
    renders: 0,
    navigates: 0,
    feedbacks: 0,
    listenerHandled: 0,
  };

  async function commitPlay() {
    effects.commits += 1;
    await Promise.resolve();
  }

  async function finishSpeakRound() {
    await commitPlay();
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.renders += 1;
  }

  async function continueSpeakRound() {
    await commitPlay();
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.renders += 1;
  }

  async function startVoteFromDecision() {
    await commitPlay();
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.renders += 1;
  }

  async function resolveVoteRound({ force = false, fail = false } = {}) {
    const outcome = await resolveVoteLock.run(async () => {
      await commitPlay();
      if (fail) throw new Error("network");
      return force ? "force" : "auto";
    });
    if (!outcome.ok) return outcome;
    if (!mount.isMounted()) return outcome;
    if (!mount.isCurrentMount()) return outcome;
    effects.renders += 1;
    return outcome;
  }

  async function maybeAdvanceFromDeal() {
    await dealAdvanceLock.run(async () => {
      await commitPlay();
    });
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.renders += 1;
  }

  async function onSessionChange(afterAwait) {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.listenerHandled += 1;
    if (afterAwait) {
      await afterAwait();
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
    }
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.renders += 1;
  }

  async function finishAndExit({ shouldContinue }) {
    await Promise.resolve();
    if (typeof shouldContinue === "function" && !shouldContinue()) return;
    effects.navigates += 1;
  }

  function feedbackAfterReject() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    effects.feedbacks += 1;
  }

  return {
    mount,
    effects,
    finishSpeakLock,
    continueSpeakLock,
    startVoteLock,
    resolveVoteLock,
    dealAdvanceLock,
    finishSpeakRound,
    continueSpeakRound,
    startVoteFromDecision,
    resolveVoteRound,
    maybeAdvanceFromDeal,
    onSessionChange,
    finishAndExit,
    feedbackAfterReject,
    clickFinishSpeak: withClickLock(() => finishSpeakRound(), { lock: finishSpeakLock }),
    clickContinue: withClickLock(() => continueSpeakRound(), { lock: continueSpeakLock }),
    clickVoteNow: withClickLock(() => startVoteFromDecision(), { lock: startVoteLock }),
  };
}

describe("ARCH-06 Traître host V2 - Mode A locks", () => {
  it("double clic finish-speak → un seul commit", async () => {
    const h = simulateTraitreHostMount();
    const gate = deferred();
    let bodyCalls = 0;
    const slow = withClickLock(
      async () => {
        bodyCalls += 1;
        await gate.promise;
        h.effects.commits += 1;
      },
      { lock: h.finishSpeakLock }
    );
    const p1 = slow({ currentTarget: null });
    const p2 = slow({ currentTarget: null });
    await Promise.resolve();
    assert.equal(bodyCalls, 1);
    gate.resolve();
    await Promise.all([p1, p2]);
    assert.equal(h.effects.commits, 1);
    assert.equal(h.finishSpeakLock.inFlight, false);
  });

  it("double clic continue / vote-now / resolve → un seul commit chacun", async () => {
    for (const [lockName, clickName] of [
      ["continueSpeakLock", "clickContinue"],
      ["startVoteLock", "clickVoteNow"],
    ]) {
      const h = simulateTraitreHostMount();
      const gate = deferred();
      let started = 0;
      const lock = h[lockName];
      const slow = withClickLock(
        async () => {
          started += 1;
          await gate.promise;
          h.effects.commits += 1;
        },
        { lock }
      );
      const p1 = slow({ currentTarget: null });
      const p2 = slow({ currentTarget: null });
      await Promise.resolve();
      assert.equal(started, 1, clickName);
      gate.resolve();
      await Promise.all([p1, p2]);
      assert.equal(h.effects.commits, 1, clickName);
      assert.equal(lock.inFlight, false, lockName);
    }

    const h = simulateTraitreHostMount();
    const gate = deferred();
    const p1 = h.resolveVoteLock.run(async () => {
      await gate.promise;
      h.effects.commits += 1;
      return true;
    });
    const p2 = h.resolveVoteLock.run(async () => {
      h.effects.commits += 1;
      return true;
    });
    await Promise.resolve();
    gate.resolve();
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a.ok, true);
    assert.equal(b.skipped, true);
    assert.equal(h.effects.commits, 1);
  });

  it("échec réseau → lock relâché", async () => {
    const h = simulateTraitreHostMount();
    await assert.rejects(() => h.resolveVoteRound({ fail: true }), /network/);
    assert.equal(h.resolveVoteLock.inFlight, false);
    assert.equal(h.effects.commits, 1);
  });

  it("succès → lock relâché", async () => {
    const h = simulateTraitreHostMount();
    const r = await h.resolveVoteRound();
    assert.equal(r.ok, true);
    assert.equal(h.resolveVoteLock.inFlight, false);
    assert.equal(h.effects.renders, 1);
  });

  it("remount pendant commit → aucun second commit / render post-await", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const old = simulateTraitreHostMount();
    const gate = deferred();
    const pending = old.resolveVoteLock.run(async () => {
      old.effects.commits += 1;
      await gate.promise;
      return true;
    });
    advanceMountGeneration();
    const neu = simulateTraitreHostMount();
    old.mount.dispose();
    gate.resolve();
    const outcome = await pending;
    assert.equal(outcome.ok, true);
    assert.equal(old.effects.commits, 1);
    if (!old.mount.isMounted()) {
      /* no post-await render */
    } else if (!old.mount.isCurrentMount()) {
      /* no post-await render */
    } else {
      old.effects.renders += 1;
    }
    assert.equal(old.effects.renders, 0);
    await neu.resolveVoteRound();
    assert.equal(neu.effects.commits, 1);
    assert.equal(neu.effects.renders, 1);
  });
});

describe("ARCH-06 Traître host V2 - Modes B/C lifecycle", () => {
  it("async ancien mount après navigation → aucun render", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const old = simulateTraitreHostMount();
    const gate = deferred();
    const p = (async () => {
      await gate.promise;
      if (!old.mount.isMounted()) return;
      if (!old.mount.isCurrentMount()) return;
      old.effects.renders += 1;
    })();
    old.mount.dispose();
    gate.resolve();
    await p;
    assert.equal(old.effects.renders, 0);
  });

  it("ancien mount après remount même écran → aucun effet", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = simulateTraitreHostMount();
    const gate = deferred();
    const p = (async () => {
      await gate.promise;
      a.effects.commits += 1;
      if (!a.mount.isMounted()) return;
      if (!a.mount.isCurrentMount()) return;
      a.effects.renders += 1;
    })();
    advanceMountGeneration();
    const b = simulateTraitreHostMount();
    a.mount.dispose();
    gate.resolve();
    await p;
    assert.equal(a.effects.commits, 1);
    assert.equal(a.effects.renders, 0);
    await b.finishSpeakRound();
    assert.equal(b.effects.renders, 1);
  });

  it("ancien rejet après remount → aucun feedback fantôme", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = simulateTraitreHostMount();
    advanceMountGeneration();
    const b = simulateTraitreHostMount();
    a.mount.dispose();
    a.feedbackAfterReject();
    assert.equal(a.effects.feedbacks, 0);
    b.feedbackAfterReject();
    assert.equal(b.effects.feedbacks, 1);
  });

  it("listener ancien mount après remount → silencieux ; nouveau continue", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const a = simulateTraitreHostMount();
    advanceMountGeneration();
    const b = simulateTraitreHostMount();
    a.mount.dispose();
    await a.onSessionChange();
    await b.onSessionChange();
    assert.equal(a.effects.listenerHandled, 0);
    assert.equal(a.effects.renders, 0);
    assert.equal(b.effects.listenerHandled, 1);
    assert.equal(b.effects.renders, 1);
  });

  it("plusieurs remounts successifs → seule la dernière instance agit", async () => {
    resetMountGenerationForTests();
    const mounts = [];
    for (let i = 0; i < 4; i += 1) {
      advanceMountGeneration();
      mounts.push(simulateTraitreHostMount());
    }
    for (let i = 0; i < mounts.length - 1; i += 1) {
      mounts[i].mount.dispose();
      await mounts[i].onSessionChange();
      assert.equal(mounts[i].effects.renders, 0);
    }
    const last = mounts[mounts.length - 1];
    await last.onSessionChange();
    assert.equal(last.effects.renders, 1);
  });

  it("shouldContinue false après await → pas de navigate exit", async () => {
    const h = simulateTraitreHostMount();
    h.mount.dispose();
    await h.finishAndExit({
      shouldContinue: () => h.mount.isMounted() && h.mount.isCurrentMount(),
    });
    assert.equal(h.effects.navigates, 0);
  });
});

describe("ARCH-06 Traître host V2 - acting host + contrats source", () => {
  const src = readSrc("../js/games/traitre.js");
  const syncSrc = readSrc("../js/core/gameSync.js");

  it("createMountGuard + dispose + double garde", () => {
    assert.match(src, /createMountGuard\(\)/);
    assert.match(src, /mount\.dispose\(\)/);
    assert.match(
      src,
      /if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.equal(/mountAlive/.test(src), false);
    assert.equal(/resolveInFlight/.test(src), false);
  });

  it("locks hôte : finish / continue / vote-now / resolve / deal / exit", () => {
    assert.match(src, /const finishSpeakLock = createActionLock\(\)/);
    assert.match(src, /const continueSpeakLock = createActionLock\(\)/);
    assert.match(src, /const startVoteLock = createActionLock\(\)/);
    assert.match(src, /const resolveVoteLock = createActionLock\(\)/);
    assert.match(src, /const dealAdvanceLock = createActionLock\(\)/);
    assert.match(src, /const exitLock = createActionLock\(\)/);
    assert.match(src, /withClickLock\([\s\S]*lock:\s*finishSpeakLock/);
    assert.match(src, /withClickLock\([\s\S]*lock:\s*continueSpeakLock/);
    assert.match(src, /withClickLock\([\s\S]*lock:\s*startVoteLock/);
    assert.match(src, /withClickLock\([\s\S]*lock:\s*exitLock/);
    assert.match(src, /await resolveVoteLock\.run\(/);
    assert.match(src, /await dealAdvanceLock\.run\(/);
  });

  it("hôte réel + acting host : même gate canActAsHost sur actions mutantes", () => {
    assert.match(src, /async function finishSpeakRound\(\) \{\s*\n\s*if \(mp && !canActAsHost\(\)\) return;/s);
    assert.match(src, /async function continueSpeakRound\(\) \{\s*\n\s*if \(mp && !canActAsHost\(\)\) return;/s);
    assert.match(src, /async function startVoteFromDecision\(\) \{\s*\n\s*if \(mp && !canActAsHost\(\)\) return;/s);
    assert.match(src, /async function resolveVoteRound\([\s\S]*?if \(mp && !canActAsHost\(\)\) return;/s);
    assert.match(src, /async function maybeAdvanceFromDeal\(\) \{[\s\S]*?if \(mp && !canActAsHost\(\)\) return;/s);
    // Invité : host flag UI via canActAsHost, pas un 2e chemin RPC dédié dans l'écran
    assert.match(src, /const host = !mp \|\| canActAsHost\(\);/);
    assert.equal(/apply_acting_host_play/.test(src), false);
  });

  it("returnToGameSelect : shouldContinue opaque (défaut true)", () => {
    assert.match(
      syncSrc,
      /export async function returnToGameSelect\(\{ shouldContinue = null \} = \{\}\)/
    );
    assert.match(
      src,
      /returnToGameSelect\(\{\s*shouldContinue: \(\) => mount\.isMounted\(\) && mount\.isCurrentMount\(\),\s*\}\)/s
    );
  });

  it("pas de 4e convention locale de lifecycle", () => {
    assert.equal(/\blet\s+cancelled\s*=/.test(src), false);
    assert.equal(/\blet\s+destroyed\s*=/.test(src), false);
    assert.equal(/\blet\s+active\s*=\s*true/.test(src), false);
  });
});

describe("ARCH-06 Traître host V2 - régression métier (contrats)", () => {
  it("transitions / scoring / commits inchangés dans l'écran", () => {
    const src = readSrc("../js/games/traitre.js");
    assert.match(src, /phase: "speak"/);
    assert.match(src, /phase: "decision"/);
    assert.match(src, /phase: "vote"/);
    assert.match(src, /buildTraitreEliminationPatch/);
    assert.match(src, /awardTraitreGame/);
    assert.match(src, /withEveningScores: patch\.phase === "final" && mp && isLobbyHost\(\)/);
    assert.match(src, /btn-force-vote/);
    assert.match(src, /phase === "final"/);
  });

  it("session listener : double garde + auto advance deal/vote", () => {
    const src = readSrc("../js/games/traitre.js");
    assert.match(
      src,
      /const unsub = onGameSessionChange\(async \(row\) => \{\s*\n\s*if \(!mount\.isMounted\(\)\) return;\s*\n\s*if \(!mount\.isCurrentMount\(\)\) return;/s
    );
    assert.match(src, /await maybeAdvanceFromDeal\(\)/);
    assert.match(src, /await resolveVoteRound\(\)/);
  });
});
