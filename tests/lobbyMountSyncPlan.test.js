import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planLobbyMountMultiplayerSync } from "../js/core/lobbyMountSyncPlan.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lobbyScreenSrc = readFileSync(
  join(__dirname, "../js/screens/lobby.js"),
  "utf8"
);

function mountLobbySource() {
  const start = lobbyScreenSrc.indexOf("export function mountLobby");
  assert.ok(start >= 0, "mountLobby introuvable");
  return lobbyScreenSrc.slice(start);
}

describe("SYN-12 / M-05b — planLobbyMountMultiplayerSync", () => {
  it("salle d’attente MP : exactement 1 start pre-refresh, pas d’early return", () => {
    const plan = planLobbyMountMultiplayerSync({
      syncActive: true,
      hasResumeScreen: false,
      eveningStarted: false,
    });
    assert.equal(plan.startCount, 1);
    assert.equal(plan.startPhase, "pre-refresh");
    assert.equal(plan.earlyReturn, null);
    assert.equal(plan.bindWaitingRoomSession, true);
  });

  it("reprise session : exactement 1 start pre-refresh + early return resume", () => {
    const plan = planLobbyMountMultiplayerSync({
      syncActive: true,
      hasResumeScreen: true,
      eveningStarted: false,
    });
    assert.equal(plan.startCount, 1);
    assert.equal(plan.startPhase, "pre-refresh");
    assert.equal(plan.earlyReturn, "resume");
    assert.equal(plan.bindWaitingRoomSession, false);
  });

  it("soirée démarrée + sync : exactement 1 start + redirect game-select", () => {
    const plan = planLobbyMountMultiplayerSync({
      syncActive: true,
      hasResumeScreen: false,
      eveningStarted: true,
    });
    assert.equal(plan.startCount, 1);
    assert.equal(plan.startPhase, "pre-refresh");
    assert.equal(plan.earlyReturn, "evening-redirect");
    assert.equal(plan.bindWaitingRoomSession, false);
  });

  it("resume prime sur eveningStarted (interstitiel avant redirect)", () => {
    const plan = planLobbyMountMultiplayerSync({
      syncActive: true,
      hasResumeScreen: true,
      eveningStarted: true,
    });
    assert.equal(plan.startCount, 1);
    assert.equal(plan.earlyReturn, "resume");
    assert.equal(plan.bindWaitingRoomSession, false);
  });

  it("soirée démarrée sans sync : 0 start + redirect (offline / démo)", () => {
    const plan = planLobbyMountMultiplayerSync({
      syncActive: false,
      hasResumeScreen: false,
      eveningStarted: true,
    });
    assert.equal(plan.startCount, 0);
    assert.equal(plan.startPhase, null);
    assert.equal(plan.earlyReturn, "evening-redirect");
    assert.equal(plan.bindWaitingRoomSession, false);
  });

  it("jamais de start post-render ni startCount > 1 (garde anti-régression)", () => {
    const cases = [
      { syncActive: true, hasResumeScreen: false, eveningStarted: false },
      { syncActive: true, hasResumeScreen: true, eveningStarted: false },
      { syncActive: true, hasResumeScreen: false, eveningStarted: true },
      { syncActive: true, hasResumeScreen: true, eveningStarted: true },
      { syncActive: false, hasResumeScreen: false, eveningStarted: false },
      { syncActive: false, hasResumeScreen: false, eveningStarted: true },
    ];
    for (const opts of cases) {
      const plan = planLobbyMountMultiplayerSync(opts);
      assert.ok(plan.startCount <= 1, `startCount>${1}: ${JSON.stringify(opts)}`);
      assert.notEqual(plan.startPhase, "post-render");
      if (plan.earlyReturn === "resume" || plan.earlyReturn === "evening-redirect") {
        assert.equal(
          plan.bindWaitingRoomSession,
          false,
          "early return ne doit pas binder la waiting room (évite 2e start)"
        );
      }
    }
  });
});

describe("SYN-12 — mountLobby source (un seul start + early returns)", () => {
  it("importe et utilise planLobbyMountMultiplayerSync", () => {
    assert.match(lobbyScreenSrc, /planLobbyMountMultiplayerSync/);
    assert.match(
      lobbyScreenSrc,
      /from ["']\.\.\/core\/lobbyMountSyncPlan\.js["']/
    );
  });

  it("un seul appel startMultiplayerSync() dans mountLobby", () => {
    const mountSrc = mountLobbySource();
    const calls = mountSrc.match(/startMultiplayerSync\(\)/g) || [];
    assert.equal(
      calls.length,
      1,
      "SYN-12 : exactement un startMultiplayerSync() dans mountLobby"
    );
  });

  it("le start est pre-refresh : avant resume et avant evening-redirect", () => {
    const mountSrc = mountLobbySource();
    const idxStart = mountSrc.indexOf("startMultiplayerSync()");
    const idxResume = mountSrc.indexOf('earlyReturn === "resume"');
    const idxEvening = mountSrc.indexOf('earlyReturn === "evening-redirect"');
    assert.ok(idxStart >= 0, "start manquant");
    assert.ok(idxResume >= 0, "branche resume manquante");
    assert.ok(idxEvening >= 0, "branche evening-redirect manquante");
    assert.ok(
      idxStart < idxResume,
      "start doit précéder early return resume (sinon start manquant sur resume)"
    );
    assert.ok(
      idxStart < idxEvening,
      "start doit précéder early return evening (sinon start manquant sur redirect)"
    );
  });

  it("après renderFull : aucun startMultiplayerSync (pas de 2e start waiting room)", () => {
    const mountSrc = mountLobbySource();
    // Appel (pas la déclaration `function renderFull`)
    const idxRenderCall = mountSrc.search(/^\s*renderFull\(\);\s*$/m);
    assert.ok(idxRenderCall >= 0, "appel renderFull() introuvable");
    const afterRenderCall = mountSrc.slice(idxRenderCall);
    assert.equal(
      (afterRenderCall.match(/startMultiplayerSync\(\)/g) || []).length,
      0,
      "2e start post-render réintroduit SYN-12"
    );
  });

  it("early returns resume / evening-redirect présents (pas de fall-through vers waiting)", () => {
    const mountSrc = mountLobbySource();
    assert.match(mountSrc, /earlyReturn === "resume"/);
    assert.match(mountSrc, /earlyReturn === "evening-redirect"/);
    assert.match(mountSrc, /return;\s*\n\s*\}\s*\n\s*if \(mountPlan\.earlyReturn === "evening-redirect"\)/);
  });
});
