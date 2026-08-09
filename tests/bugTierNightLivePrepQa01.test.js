/**
 * BUG-TIERNIGHT-LIVE-PREP-QA-01 — refreshFromSync is not a function on live prep mount.
 *
 * Cause : syncPrepOnMount attend une fonction ; Rank Live passait un objet
 * { refreshGameSession, isGameSyncActive, onSynced }. Après refresh OK, l'objet
 * était appelé → TypeError catché → popup 📡 Connexion.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, beforeEach, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

// Node test env: bindPrepLaunchButtons uses CSS.escape
if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
}

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), unsubscribe: () => {} }),
    },
  },
});

mock.module("../js/core/supabaseAuth.js", {
  namedExports: {
    getSupabaseUserId: () => "uid-host",
  },
});

let syncActive = true;
let refreshCalls = 0;
let refreshImpl = async () => ({ ok: true });
const sessionListeners = [];
mock.module("../js/core/gameSync.js", {
  namedExports: {
    isGameSyncActive: () => syncActive,
    isLobbyHost: () => true,
    canActAsHost: () => true,
    allMembersReady: () => false,
    patchGameState: async () => ({ ok: true }),
    tierNightPrepToRemote: (s = {}) => s,
    tierNightPrepFromRemote: (r) => r || {},
    requireLocalParticipantUid: () => "uid-host",
    applyRemoteSession: () => {},
    refreshGameSession: async () => {
      refreshCalls += 1;
      return refreshImpl();
    },
    getCachedGameSession: () => null,
    onGameSessionChange: (fn) => {
      sessionListeners.push(fn);
      return () => {
        const i = sessionListeners.indexOf(fn);
        if (i >= 0) sessionListeners.splice(i, 1);
      };
    },
  },
});

const lobbyListeners = [];
mock.module("../js/core/supabaseLobby.js", {
  namedExports: {
    onLobbyBundleUpdated: (fn) => {
      lobbyListeners.push(fn);
      return () => {
        const i = lobbyListeners.indexOf(fn);
        if (i >= 0) lobbyListeners.splice(i, 1);
      };
    },
  },
});

mock.module("../js/core/gameGuard.js", {
  namedExports: {
    requireLobbyPlay: () => true,
  },
});

mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    commitPrepReadyToggle: async () => {},
    navigateAfterGameLaunch: () => {},
    prepGuestFollowOnSession: () => () => false,
    runPrepGameLaunch: async () => ({ ok: false }),
  },
});

const alerts = [];
mock.module("../js/core/dialog.js", {
  namedExports: {
    showAppAlert: async (message, opts = {}) => {
      alerts.push({ message, ...opts });
    },
    showAppConfirm: async () => true,
    showAppRichDialog: async () => {},
  },
});

mock.module("../js/core/router.js", {
  namedExports: {
    navigate: () => {},
    getScreenParams: () => ({}),
    getNavStack: () => ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"],
    getCurrentScreen: () => "tiernight-live-prep",
  },
});

mock.module("../js/core/lobby.js", {
  namedExports: {
    getLobbyParticipants: () => [
      { name: "Host", userId: "uid-host" },
      { name: "Guest", userId: "uid-guest" },
    ],
    setLobbyPlaying: async () => {},
    hasActiveLobby: () => true,
  },
});

mock.module("../js/core/players.js", {
  namedExports: {
    getActivePlayerNames: () => ["Host", "Guest"],
    getActivePlayers: () => [
      { name: "Host", userId: "uid-host", isLocal: true },
      { name: "Guest", userId: "uid-guest", isLocal: false },
    ],
  },
});

mock.module("../js/screens/nav.js", {
  namedExports: {
    bindNav: () => {},
  },
});

const { saveStatePatch, resetGameSessionsOnly } = await import("../js/core/state.js");
const { runSyncPrepOnMount } = await import("../js/core/syncPrepMount.js");
const { mountTierNightLivePrep } = await import("../js/screens/tierNightLivePrep.js");

function makeEl(overrides = {}) {
  return {
    innerHTML: "",
    textContent: "",
    disabled: false,
    classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => true,
    ...overrides,
  };
}

function makeApp() {
  const nodes = new Map();
  const app = makeEl({
    querySelector(sel) {
      if (!nodes.has(sel)) nodes.set(sel, makeEl());
      return nodes.get(sel);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener: () => {},
    contains: () => true,
  });
  return app;
}

beforeEach(() => {
  syncActive = true;
  refreshCalls = 0;
  refreshImpl = async () => ({ ok: true });
  alerts.length = 0;
  sessionListeners.length = 0;
  lobbyListeners.length = 0;
  resetGameSessionsOnly();
  saveStatePatch({
    localPlayer: { name: "Host", userId: "uid-host" },
    tierNightLiveSeriesPrep: {
      categoryIds: ["*"],
      roundCount: 5,
      ready: {},
      setupEpoch: 0,
    },
    tierNightSeriesPrep: {
      categoryIds: ["*"],
      roundCount: 5,
      ready: {},
      setupEpoch: 0,
    },
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-01 — contrats source", () => {
  it("live prep passe une fonction à syncPrepOnMount (pas un objet options)", () => {
    const src = read("js/screens/tierNightLivePrep.js");
    assert.match(src, /syncPrepOnMount\(\s*refreshFromSync\s*\)/);
    assert.doesNotMatch(
      src,
      /syncPrepOnMount\(\s*\{[\s\S]*onSynced\s*:/
    );
  });

  it("live prep passe l'objet { isActive, refresh, refreshFromSync } à runPrepRefreshOnLobbyChange", () => {
    const src = read("js/screens/tierNightLivePrep.js");
    assert.match(
      src,
      /runPrepRefreshOnLobbyChange\(\s*\{[\s\S]*isActive\s*:\s*isGameSyncActive[\s\S]*refresh\s*:\s*refreshGameSession[\s\S]*refreshFromSync[\s\S]*\}\s*\)/
    );
  });

  it("roster prep conserve le même contrat (non-régression)", () => {
    const src = read("js/screens/tierNightPrep.js");
    assert.match(src, /syncPrepOnMount\(\s*refreshFromSync\s*\)/);
    assert.match(
      src,
      /runPrepRefreshOnLobbyChange\(\s*\{[\s\S]*refreshFromSync[\s\S]*\}\s*\)/
    );
  });

  it("Hot Take prep conserve le même contrat (non-régression)", () => {
    const src = read("js/screens/hotTakePrep.js");
    assert.match(src, /syncPrepOnMount\(\s*refreshFromSync\s*\)/);
    assert.match(
      src,
      /runPrepRefreshOnLobbyChange\(\s*\{[\s\S]*refreshFromSync[\s\S]*\}\s*\)/
    );
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-01 — syncPrepOnMount comportement", () => {
  it("objet passé comme refreshFromSync → TypeError catché (repro de la cause)", async () => {
    const bogus = {
      refreshGameSession: async () => ({}),
      isGameSyncActive: () => true,
      onSynced: () => {},
    };
    let reported = null;
    const out = await runSyncPrepOnMount({
      isActive: () => true,
      refresh: async () => ({ ok: true }),
      refreshFromSync: bogus,
      reportError: async (e) => {
        reported = e;
      },
    });
    assert.equal(out.ok, false);
    assert.match(String(reported?.message || reported || ""), /not a function/i);
  });

  it("fonction refreshFromSync callable après refresh OK", async () => {
    let calls = 0;
    const out = await runSyncPrepOnMount({
      isActive: () => true,
      refresh: async () => ({ ok: true }),
      refreshFromSync: () => {
        calls += 1;
      },
      reportError: async () => {
        throw new Error("should not report");
      },
    });
    assert.equal(out.ok, true);
    assert.equal(calls, 1);
  });

  it("refresh async OK ; échec refresh → reportError, pas Uncaught", async () => {
    const err = new Error("failed to fetch");
    let reported = null;
    const out = await runSyncPrepOnMount({
      isActive: () => true,
      refresh: async () => {
        throw err;
      },
      refreshFromSync: () => {
        throw new Error("should not run");
      },
      reportError: async (e) => {
        reported = e;
      },
    });
    assert.equal(out.ok, false);
    assert.equal(reported, err);
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-01 — mount live prep", () => {
  it("host mount : aucun throw, refresh exécuté, pas de popup Connexion TypeError", async () => {
    const app = makeApp();
    const unmount = mountTierNightLivePrep(app);
    assert.equal(typeof unmount, "function");
    // Laisser le microtask de syncPrepOnMount se résoudre
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(refreshCalls >= 1, "refreshGameSession doit tourner au mount si sync active");
    const typeErr = alerts.find((a) =>
      String(a.message || "").includes("refreshFromSync is not a function")
    );
    assert.equal(typeErr, undefined);
    assert.equal(
      alerts.filter((a) => a.title === "Connexion" && String(a.message || "").includes("is not a function"))
        .length,
      0
    );
    unmount?.();
  });

  it("guest mount : même contrat (sync active, pas de TypeError)", async () => {
    saveStatePatch({
      localPlayer: { name: "Guest", userId: "uid-guest" },
    });
    const app = makeApp();
    const unmount = mountTierNightLivePrep(app);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(refreshCalls >= 1);
    assert.equal(
      alerts.some((a) => String(a.message || "").includes("refreshFromSync is not a function")),
      false
    );
    unmount?.();
  });

  it("lobby change déclenche runPrepRefreshOnLobbyChange sans TypeError", async () => {
    const app = makeApp();
    const unmount = mountTierNightLivePrep(app);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    refreshCalls = 0;
    assert.ok(lobbyListeners.length >= 1);
    for (const fn of [...lobbyListeners]) fn();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(refreshCalls >= 1);
    assert.equal(
      alerts.some((a) => String(a.message || "").includes("is not a function")),
      false
    );
    unmount?.();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-01 — popup Connexion mapping", () => {
  it("defaultMountSyncError mappe tout err.message via formatSyncErrorMessage (TypeError → texte brut sous titre Connexion)", () => {
    const prep = read("js/core/prepScreen.js");
    assert.match(prep, /title:\s*"Connexion"/);
    assert.match(prep, /icon:\s*"📡"/);
    assert.match(prep, /formatSyncErrorMessage\(err\?\.message\)/);
    // Pas de filtre TypeError vs réseau — wording masque les bugs de programmation.
    assert.doesNotMatch(prep, /isSyncNetworkError/);
  });
});
