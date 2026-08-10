/**
 * BUG-TIERNIGHT-PREP-EXIT-MODES — sortie prep → hub modes (série + live).
 * Pas d'endGameSession / DELETE game_sessions ; guest-follow prep → select explicite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, beforeEach, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
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

let syncActive = false;
let lobbyHost = true;
const patched = [];
let endGameSessionCalls = 0;
let cachedSession = null;

mock.module("../js/core/gameSync.js", {
  namedExports: {
    isGameSyncActive: () => syncActive,
    isLobbyHost: () => lobbyHost,
    canActAsHost: () => lobbyHost,
    allMembersReady: () => false,
    patchGameState: async (payload, opts) => {
      patched.push({ payload, opts });
      if (opts?.screen) {
        cachedSession = {
          ...(cachedSession || {}),
          screen: opts.screen,
          game_id: opts.gameId || "tiernight",
          state: {
            ...(cachedSession?.state || {}),
            ...payload,
          },
        };
      }
      return cachedSession || { ok: true, screen: opts?.screen };
    },
    endGameSession: async () => {
      endGameSessionCalls += 1;
    },
    pushGameSession: async () => null,
    DEFAULT_SYNC_PATCH_TIMEOUT_MS: 20000,
    getActingHostUserId: () => (lobbyHost ? "uid-host" : null),
    tierNightPrepToRemote: (session = {}) => ({
      categoryIds: Array.isArray(session.categoryIds) ? session.categoryIds : ["*"],
      roundCount: session.roundCount ?? 5,
      ready: { ...(session.ready || {}) },
      setupEpoch: Number(session.setupEpoch) || 0,
      poolInvalidateRequestId: session.poolInvalidateRequestId ?? null,
    }),
    tierNightPrepFromRemote: (remote) => {
      if (!remote || typeof remote !== "object") {
        return { categoryIds: ["*"], roundCount: 5, ready: {}, setupEpoch: 0 };
      }
      return {
        categoryIds: Array.isArray(remote.categoryIds) ? remote.categoryIds.map(String) : ["*"],
        roundCount: remote.roundCount ?? 5,
        ready: { ...(remote.ready || {}) },
        setupEpoch: Number(remote.setupEpoch) || 0,
        poolInvalidateRequestId: remote.poolInvalidateRequestId
          ? String(remote.poolInvalidateRequestId)
          : null,
      };
    },
    requireLocalParticipantUid: () => "uid-host",
    applyRemoteSession: () => {},
    refreshGameSession: async () => cachedSession,
    getCachedGameSession: () => cachedSession,
    getEffectiveSessionScreen: (row) => row?.screen || null,
    onGameSessionChange: () => () => {},
  },
});

const navigated = [];
let navStack = ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep"];
let screenParams = {};
let currentScreen = "tiernight-prep";

mock.module("../js/core/router.js", {
  namedExports: {
    navigate: (screen, opts = {}) => {
      navigated.push({ screen, opts });
      currentScreen = screen;
      if (opts.navStack) navStack = [...opts.navStack];
      else if (opts.reset) navStack = [screen];
      else if (navStack[navStack.length - 1] !== screen) navStack.push(screen);
      screenParams = opts.params || {};
      return true;
    },
    getScreenParams: () => screenParams,
    getNavStack: () => [...navStack],
    getCurrentScreen: () => currentScreen,
    goBack: () => {},
    resetNav: () => {
      navStack = ["home"];
      currentScreen = "home";
      screenParams = {};
    },
    initRouter: () => {},
    registerScreen: () => {},
  },
});

mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    commitPrepReadyToggle: async () => {},
    navigateAfterGameLaunch: () => {},
    commitHostGamePlay: async () => null,
    commitMultiplayerLaunch: async () => ({ ok: true }),
    launchGameWithSync: async () => ({ ok: true }),
    runLaunchButton: async (_btn, fn) => fn(),
    gamePatchOpts: (gameId, screen) => ({ gameId, screen, timeoutMs: 20000 }),
    computePrepReadyToggle: () => ({ nextReady: {}, readyKey: "Host" }),
    SYNC_PATCH_TIMEOUT_MS: 20000,
    prepGuestFollowOnSession: ({
      prepScreen,
      getEntryScreen,
      buildNavStack,
      buildNavigateOpts = null,
    }) => {
      return () => {
        const entry = getEntryScreen();
        if (entry === prepScreen) return false;
        const opts =
          (typeof buildNavigateOpts === "function" && buildNavigateOpts(entry)) ||
          (buildNavStack ? { navStack: buildNavStack(entry) } : { reset: true });
        navigated.push({ screen: entry, opts });
        currentScreen = entry;
        if (opts.navStack) navStack = [...opts.navStack];
        screenParams = opts.params || {};
        return true;
      };
    },
    runPrepGameLaunch: async () => ({ ok: false }),
  },
});

mock.module("../js/core/supabaseAuth.js", {
  namedExports: {
    getSupabaseUserId: () => "uid-host",
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

const { getState, saveStatePatch } = await import("../js/core/state.js");
const {
  leaveTierNightSeriesPrepToModes,
  leaveTierNightLivePrepToModes,
  TIER_NIGHT_PREP_MODES_EXIT_NAV,
} = await import("../js/core/tierNightNav.js");
const { prepGuestFollowOnSession } = await import("../js/core/mpLaunch.js");

function seedSeriesPrep({ epoch = 2, ready = { Host: true } } = {}) {
  saveStatePatch({
    tierNightSeriesPrep: {
      categoryIds: ["fun"],
      roundCount: 8,
      ready: { ...ready },
      setupEpoch: epoch,
      poolInvalidateRequestId: null,
    },
    tierNightGame: {
      mode: "roster",
      lobbyStarted: false,
      series: { kind: "roster", phase: "ranking", roundIndex: 0 },
      items: ["a", "b"],
    },
  });
}

function seedLivePrep({ epoch = 4, ready = { Host: true } } = {}) {
  saveStatePatch({
    tierNightLiveSeriesPrep: {
      categoryIds: ["*"],
      roundCount: 7,
      ready: { ...ready },
      setupEpoch: epoch,
      poolInvalidateRequestId: null,
    },
  });
}

describe("BUG-TIERNIGHT-PREP-EXIT-MODES — source wiring", () => {
  it("série : chevron dédié, pas backTarget back", () => {
    const src = read("js/screens/tierNightPrep.js");
    assert.match(src, /TIER_NIGHT_PREP_MODES_EXIT_NAV/);
    assert.match(src, /leaveTierNightSeriesPrepToModes/);
    assert.doesNotMatch(src, /backTarget:\s*["']back["']/);
  });

  it("live : chevron dédié, pas navigate nu tiernight-select", () => {
    const src = read("js/screens/tierNightLivePrep.js");
    assert.match(src, /TIER_NIGHT_PREP_MODES_EXIT_NAV/);
    assert.match(src, /leaveTierNightLivePrepToModes/);
    assert.doesNotMatch(src, /backTarget:\s*["']tiernight-select["']/);
    assert.match(src, /effective === ["']tiernight-select["']/);
  });

  it("nav key exportée + helpers présents", () => {
    assert.equal(TIER_NIGHT_PREP_MODES_EXIT_NAV, "tiernight-modes-exit");
    const nav = read("js/core/tierNightNav.js");
    assert.match(nav, /leaveTierNightSeriesPrepToModes/);
    assert.match(nav, /leaveTierNightLivePrepToModes/);
    assert.match(nav, /screen:\s*["']tiernight-select["']/);
    assert.doesNotMatch(nav, /await\s+endGameSession/);
    assert.doesNotMatch(nav, /\bleaveGameSetup\s*\(/);
    assert.doesNotMatch(nav, /\breturnToGameSelect\s*\(/);
  });
});

describe("BUG-TIERNIGHT-PREP-EXIT-MODES — série host", () => {
  beforeEach(() => {
    patched.length = 0;
    navigated.length = 0;
    endGameSessionCalls = 0;
    syncActive = true;
    lobbyHost = true;
    cachedSession = {
      screen: "tiernight-prep",
      game_id: "tiernight",
      state: {},
    };
    navStack = ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep"];
    currentScreen = "tiernight-prep";
    screenParams = {};
    seedSeriesPrep({ epoch: 3, ready: { Host: true, Guest: true } });
  });

  it("host → select step=mode mode=roster ; pas game-select ; pas endGameSession", async () => {
    const beforeSeries = getState().tierNightGame;
    const beforeEpoch = getState().tierNightSeriesPrep.setupEpoch;

    const res = await leaveTierNightSeriesPrepToModes();
    assert.equal(res.ok, true);

    assert.equal(currentScreen, "tiernight-select");
    assert.deepEqual(screenParams, { step: "mode", mode: "roster" });
    assert.equal(navStack.includes("tiernight-prep"), false);
    assert.equal(navStack.at(-1), "tiernight-select");
    assert.equal(navigated.some((n) => n.screen === "game-select"), false);

    assert.equal(endGameSessionCalls, 0);
    assert.equal(patched.length, 1);
    assert.equal(patched[0].opts.screen, "tiernight-select");
    assert.equal(patched[0].opts.gameId, "tiernight");
    assert.equal(patched[0].payload.tierNightPrep.setupEpoch, beforeEpoch + 1);
    assert.deepEqual(patched[0].payload.tierNightPrep.ready, {});
    assert.equal(Object.prototype.hasOwnProperty.call(patched[0].payload, "tierNight"), false);

    assert.equal(getState().tierNightSeriesPrep.setupEpoch, beforeEpoch + 1);
    assert.deepEqual(getState().tierNightGame, beforeSeries);
    assert.equal(cachedSession.screen, "tiernight-select");
  });

  it("solo : reset local + nav, zéro patch", async () => {
    syncActive = false;
    const beforeEpoch = getState().tierNightSeriesPrep.setupEpoch;
    const res = await leaveTierNightSeriesPrepToModes();
    assert.equal(res.ok, true);
    assert.equal(res.localOnly, true);
    assert.equal(patched.length, 0);
    assert.equal(currentScreen, "tiernight-select");
    assert.equal(getState().tierNightSeriesPrep.setupEpoch, beforeEpoch + 1);
  });
});

describe("BUG-TIERNIGHT-PREP-EXIT-MODES — live host", () => {
  beforeEach(() => {
    patched.length = 0;
    navigated.length = 0;
    endGameSessionCalls = 0;
    syncActive = true;
    lobbyHost = true;
    cachedSession = {
      screen: "tiernight-live-prep",
      game_id: "tiernight",
      state: {},
    };
    navStack = ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"];
    currentScreen = "tiernight-live-prep";
    screenParams = {};
    seedLivePrep({ epoch: 5, ready: { Host: true } });
  });

  it("host → select step=mode mode=live ; patch live prep + nouvel epoch", async () => {
    const beforeEpoch = getState().tierNightLiveSeriesPrep.setupEpoch;
    const res = await leaveTierNightLivePrepToModes();
    assert.equal(res.ok, true);

    assert.equal(currentScreen, "tiernight-select");
    assert.deepEqual(screenParams, { step: "mode", mode: "live" });
    assert.equal(navStack.includes("tiernight-live-prep"), false);
    assert.equal(endGameSessionCalls, 0);

    assert.equal(patched.length, 1);
    assert.equal(patched[0].opts.screen, "tiernight-select");
    assert.ok(patched[0].payload.tierNightLivePrep);
    assert.equal(patched[0].payload.tierNightLivePrep.setupEpoch, beforeEpoch + 1);
    assert.deepEqual(patched[0].payload.tierNightLivePrep.ready, {});
    assert.equal(getState().tierNightLiveSeriesPrep.setupEpoch, beforeEpoch + 1);
  });
});

describe("BUG-TIERNIGHT-PREP-EXIT-MODES — guest-follow prep → select", () => {
  it("série : effective select → navigate step=mode roster", () => {
    cachedSession = { screen: "tiernight-select", game_id: "tiernight", state: {} };
    navigated.length = 0;
    navStack = ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep"];
    currentScreen = "tiernight-prep";

    const follow = prepGuestFollowOnSession({
      prepScreen: "tiernight-prep",
      getEntryScreen: () => {
        const effective = cachedSession?.screen;
        if (effective === "tiernight-select") return "tiernight-select";
        return "tiernight-prep";
      },
      buildNavigateOpts: (entry) => {
        if (entry === "tiernight-select") {
          return {
            params: { step: "mode", mode: "roster" },
            navStack: ["home", "lobby", "game-select", "tiernight-select"],
          };
        }
        return { navStack: ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep"] };
      },
    });

    assert.equal(follow(), true);
    assert.equal(currentScreen, "tiernight-select");
    assert.deepEqual(screenParams, { step: "mode", mode: "roster" });
    assert.equal(navStack.includes("tiernight-prep"), false);
  });

  it("série : effective prep → rester", () => {
    cachedSession = { screen: "tiernight-prep", game_id: "tiernight", state: {} };
    navigated.length = 0;
    const follow = prepGuestFollowOnSession({
      prepScreen: "tiernight-prep",
      getEntryScreen: () => {
        const effective = cachedSession?.screen;
        if (effective === "tiernight-select") return "tiernight-select";
        return "tiernight-prep";
      },
      buildNavigateOpts: () => ({ navStack: [] }),
    });
    assert.equal(follow(), false);
    assert.equal(navigated.length, 0);
  });

  it("live : effective select → navigate step=mode live", () => {
    cachedSession = { screen: "tiernight-select", game_id: "tiernight", state: {} };
    navigated.length = 0;
    navStack = ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"];
    currentScreen = "tiernight-live-prep";

    const follow = prepGuestFollowOnSession({
      prepScreen: "tiernight-live-prep",
      getEntryScreen: () => {
        const effective = cachedSession?.screen;
        if (effective === "tiernight-select") return "tiernight-select";
        return "tiernight-live-prep";
      },
      buildNavigateOpts: (entry) => {
        if (entry === "tiernight-select") {
          return {
            params: { step: "mode", mode: "live" },
            navStack: ["home", "lobby", "game-select", "tiernight-select"],
          };
        }
        return {
          navStack: ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"],
        };
      },
    });

    assert.equal(follow(), true);
    assert.equal(currentScreen, "tiernight-select");
    assert.deepEqual(screenParams, { step: "mode", mode: "live" });
    assert.equal(navStack.includes("tiernight-live-prep"), false);
  });
});

describe("BUG-TIERNIGHT-PREP-EXIT-MODES — régressions source", () => {
  it("changeTierNightModeFromSeriesPlay intact", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /export async function changeTierNightModeFromSeriesPlay/);
    assert.match(exit, /applySeriesClearAndPrepReset/);
  });

  it("leaveGameSetup / returnToGameSelect inchangés (autres jeux)", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /export async function leaveGameSetup/);
    assert.match(sync, /export async function returnToGameSelect/);
    assert.match(sync, /await endGameSession\(\)/);
  });

  it("famille TIER_NIGHT_PREP_SCREENS non élargie", () => {
    const sync = read("js/core/gameSync.js");
    const block = sync.match(
      /const TIER_NIGHT_PREP_SCREENS = new Set\(\[([\s\S]*?)\]\)/
    );
    assert.ok(block);
    assert.match(block[1], /tiernight-select/);
    assert.match(block[1], /tiernight-prep/);
    assert.match(block[1], /tiernight-live-prep/);
    assert.doesNotMatch(block[1], /tiernight-between/);
  });

  it("select guestFollow conserve prep/play", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /prepGuestFollowOnSession/);
    assert.match(select, /tiernight-prep/);
    assert.match(select, /tiernight-live-prep/);
  });
});
