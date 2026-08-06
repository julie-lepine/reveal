/**
 * QA C2 - Recommencer TierNight ne doit pas ramener l'ancien récap.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldPreferTierNightEndRoute,
  finishedTierNightLiveRemote,
  createTierNightRunId,
  tierNightRecapBelongsToRun,
} from "../js/core/tierNightConfig.js";
import {
  createMountGuard,
  advanceMountGeneration,
  resetMountGenerationForTests,
} from "../js/core/mountLifecycle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSrc(rel) {
  return readFileSync(join(__dirname, rel), "utf8");
}

function placedRecap(runId = "run-old") {
  return {
    runId,
    topicId: "t1",
    listName: "Liste",
    recaps: [
      {
        player: "Alice",
        emoji: "🦊",
        color: "#f00",
        placed: { S: ["a"], A: [], B: [], C: [], D: [] },
        consensusPoints: 10,
      },
    ],
  };
}

describe("TierNight Recommencer - pas de retour vers l'ancien récap", () => {
  beforeEach(() => {
    resetMountGenerationForTests();
  });

  it("tierNightRecapBelongsToRun : false si runId session ≠ runId récap", () => {
    assert.equal(
      tierNightRecapBelongsToRun({
        runId: "run-new",
        lobbyStarted: false,
        recap: placedRecap("run-old"),
      }),
      false
    );
  });

  it("tierNightRecapBelongsToRun : false si nouveau run sans recapRunId", () => {
    const recap = placedRecap("run-old");
    delete recap.runId;
    assert.equal(
      tierNightRecapBelongsToRun({
        runId: "run-new",
        lobbyStarted: false,
        recap,
      }),
      false
    );
  });

  it("tierNightRecapBelongsToRun : true si run courant = récap", () => {
    assert.equal(
      tierNightRecapBelongsToRun({
        runId: "run-1",
        lobbyStarted: false,
        recap: placedRecap("run-1"),
      }),
      true
    );
  });

  it("tierNightRecapBelongsToRun : false si recap null (reset)", () => {
    assert.equal(
      tierNightRecapBelongsToRun({
        runId: "run-new",
        lobbyStarted: false,
        recap: null,
      }),
      false
    );
  });

  it("shouldPreferTierNightEndRoute : select + reset ne préfère pas end", () => {
    assert.equal(
      shouldPreferTierNightEndRoute({
        state: {
          tierNight: { runId: "run-new", lobbyStarted: false, recap: null },
          tierNightLive: finishedTierNightLiveRemote({ runId: "run-new" }),
        },
        declared: "tiernight-select",
        local: "tiernight-select",
        localHasRecap: false,
      }),
      false
    );
  });

  it("shouldPreferTierNightEndRoute : declared select même avec localHasRecap stale", () => {
    assert.equal(
      shouldPreferTierNightEndRoute({
        state: {
          tierNight: { runId: "run-new", lobbyStarted: false, recap: null },
        },
        declared: "tiernight-select",
        local: "tiernight-end",
        localHasRecap: true,
      }),
      false
    );
  });

  it("finalisation async après dispose → shouldContinue bloque navigate", async () => {
    advanceMountGeneration();
    const mount = createMountGuard();
    let navigates = 0;
    let commits = 0;
    const gate = new Promise((r) => setTimeout(r, 5));

    const p = (async () => {
      commits += 1;
      await gate;
      const shouldContinue = () => mount.isMounted() && mount.isCurrentMount();
      if (!shouldContinue()) return false;
      navigates += 1;
      return true;
    })();

    mount.dispose();
    advanceMountGeneration();
    const ok = await p;
    assert.equal(ok, false);
    assert.equal(commits, 1);
    assert.equal(navigates, 0);
  });

  it("bootstrap récap après remount : double garde empêche render fantôme", async () => {
    advanceMountGeneration();
    const mount = createMountGuard();
    let renders = 0;
    const gate = new Promise((r) => setTimeout(r, 5));

    const bootstrap = async () => {
      await gate;
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      renders += 1;
    };

    const pending = bootstrap();
    mount.dispose();
    advanceMountGeneration();
    await pending;
    assert.equal(renders, 0);
  });

  it("launchTierNightSelect pousse recap: null + nouveau runId", () => {
    const s = readSrc("../js/core/restartGame.js");
    assert.match(s, /async function launchTierNightSelect/);
    assert.match(s, /recap:\s*null/);
    assert.match(s, /createTierNightRunId\(\)/);
    assert.match(s, /screen:\s*"tiernight-select"/);
  });

  it("tierNightEnd : createMountGuard + ignore screen hors end", () => {
    const s = readSrc("../js/screens/tierNightEnd.js");
    assert.match(s, /createMountGuard/);
    assert.match(s, /mount\.dispose\(\)/);
    assert.match(s, /if \(!mount\.isMounted\(\)\) return;/);
    assert.match(s, /if \(!mount\.isCurrentMount\(\)\) return;/);
    assert.match(s, /if \(row\?\.screen && row\.screen !== "tiernight-end"\) return;/);
  });

  it("gameSync canRouteToTierNightEnd : recap legacy + series_end (D)", () => {
    const s = readSrc("../js/core/gameSync.js");
    assert.match(s, /tierNightRecapBelongsToRun/);
    assert.match(s, /export function canRouteToTierNightEnd\(row\)/);
    assert.match(s, /tn\?\.series\?\.phase === "series_end"/);
    assert.match(s, /roundHistory/);
  });

  it("createTierNightRunId produit des ids distincts", () => {
    assert.notEqual(createTierNightRunId(), createTierNightRunId());
  });
});
