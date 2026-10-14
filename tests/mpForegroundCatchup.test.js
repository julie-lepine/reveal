/**
 * P1 — rattrapage multijoueur au retour au premier plan.
 * Signaux visibilitychange et App.appStateChange, cycles et jetons.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bumpLobbyRuntimeGeneration,
  __resetLobbyRuntimeGenerationForTests,
  getLobbyRuntimeGeneration,
} from "../js/core/lobbyRuntime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gameSyncSrc = readFileSync(join(__dirname, "../js/core/gameSync.js"), "utf8").replace(
  /\r\n/g,
  "\n"
);

const LOBBY_A = "lobby-fg-a";
const LOBBY_B = "lobby-fg-b";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const visibilityListeners = new Set();
const documentStub = {
  hidden: false,
  visibilityState: "visible",
  addEventListener(type, fn) {
    if (type === "visibilitychange") visibilityListeners.add(fn);
  },
  removeEventListener(type, fn) {
    if (type === "visibilitychange") visibilityListeners.delete(fn);
  },
};
globalThis.document = documentStub;

const nativeListeners = [];
let addListenerCalls = 0;
const nativeHandle = {
  removed: false,
  remove() {
    this.removed = true;
  },
};

function installCapacitor() {
  nativeHandle.removed = false;
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
      Plugins: {
        App: {
          addListener(event, cb) {
            addListenerCalls += 1;
            nativeListeners.push({ event, cb });
            return Promise.resolve(nativeHandle);
          },
        },
      },
    },
  };
}

const refreshCalls = [];
const resubscribeMock = mock.fn();
const subscribeLobbyRealtimeMock = mock.fn();
const removeChannelMock = mock.fn();

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function foregroundLobbyModule() {
  return {
    resubscribeLobbyRealtime: resubscribeMock,
    refreshLobbyFromSupabase: () => {
      const entry = defer();
      refreshCalls.push(entry);
      return entry.promise;
    },
    subscribeLobbyRealtime: subscribeLobbyRealtimeMock,
    removeChannel: removeChannelMock,
    getLobbyRealtimeMeta: () => ({ gen: 1, status: "subscribed" }),
    isJoinSessionHydrating: () => false,
  };
}

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: {
      removeChannel: removeChannelMock,
      channel() {
        return this;
      },
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
      getChannels: () => [],
      from() {
        return this;
      },
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({ data: null, error: null }),
    },
  },
});

const { saveStatePatch, getState } = await import("../js/core/state.js");
const {
  initMultiplayerSyncVisibility,
  __testResetSyncVisibilityForTests,
  __testReadForegroundCatchUpForTests,
  __testSetForegroundLobbyImporterForTests,
} = await import("../js/core/gameSync.js");

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function emitVisibility() {
  for (const fn of visibilityListeners) fn();
}

function hide() {
  documentStub.hidden = true;
  documentStub.visibilityState = "hidden";
  emitVisibility();
}

function show() {
  documentStub.hidden = false;
  documentStub.visibilityState = "visible";
  emitVisibility();
}

function emitNative(isActive) {
  for (const entry of nativeListeners) {
    if (entry.event === "appStateChange") entry.cb({ isActive });
  }
}

function enterLobby(id = LOBBY_A) {
  saveStatePatch({
    inLobby: true,
    lobby: { id, code: "ABCDEF", status: "waiting", participants: [] },
  });
}

function leaveLobbyState() {
  saveStatePatch({ inLobby: false, lobby: { id: null }, lobbyCode: null });
}

const intervalIds = new Set();
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

describe("P1 foreground catch-up", () => {
  beforeEach(async () => {
    storage.clear();
    visibilityListeners.clear();
    nativeListeners.length = 0;
    addListenerCalls = 0;
    refreshCalls.length = 0;
    resubscribeMock.mock.resetCalls();
    subscribeLobbyRealtimeMock.mock.resetCalls();
    removeChannelMock.mock.resetCalls();
    __resetLobbyRuntimeGenerationForTests();
    __testResetSyncVisibilityForTests();
    __testSetForegroundLobbyImporterForTests(async () => foregroundLobbyModule());
    documentStub.hidden = false;
    documentStub.visibilityState = "visible";
    installCapacitor();
    enterLobby(LOBBY_A);
    globalThis.setInterval = (fn, ms, ...rest) => {
      const id = originalSetInterval(fn, ms, ...rest);
      id?.unref?.();
      intervalIds.add(id);
      return id;
    };
    globalThis.clearInterval = (id) => {
      intervalIds.delete(id);
      return originalClearInterval(id);
    };
  });

  afterEach(() => {
    __testResetSyncVisibilityForTests();
    for (const id of intervalIds) originalClearInterval(id);
    intervalIds.clear();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    delete globalThis.window;
  });

  async function boot() {
    initMultiplayerSyncVisibility();
    await flush();
  }

  async function pauseThen(signal) {
    await boot();
    hide();
    signal();
    await flush();
  }

  it("1. retour navigateur après pause : un poll, un tick, une resouscription, un refresh", async () => {
    await pauseThen(() => show());
    const state = __testReadForegroundCatchUpForTests();
    assert.equal(state.syncTickCalls, 1);
    assert.equal(state.pollTimerActive, true);
    assert.equal(intervalIds.size, 1);
    assert.equal(resubscribeMock.mock.callCount(), 1);
    assert.equal(refreshCalls.length, 1);
    refreshCalls[0].resolve();
    await flush();
    assert.equal(__testReadForegroundCatchUpForTests().phase, "idle");
  });

  it("2. retour natif seul après pause, document.hidden reste vrai", async () => {
    await boot();
    hide();
    assert.equal(documentStub.hidden, true);
    emitNative(true);
    await flush();
    assert.equal(documentStub.hidden, true);
    assert.equal(resubscribeMock.mock.callCount(), 1);
    assert.equal(refreshCalls.length, 1);
    assert.equal(__testReadForegroundCatchUpForTests().syncTickCalls, 1);
    assert.equal(__testReadForegroundCatchUpForTests().pollTimerActive, true);
  });

  it("3. natif actif sans pause, poll déjà en route : aucune resouscription", async () => {
    await pauseThen(() => show());
    refreshCalls[0].resolve();
    await flush();
    const before = resubscribeMock.mock.callCount();
    const ticks = __testReadForegroundCatchUpForTests().syncTickCalls;
    const refreshes = refreshCalls.length;
    assert.equal(__testReadForegroundCatchUpForTests().phase, "idle");
    assert.equal(__testReadForegroundCatchUpForTests().paused, false);
    assert.equal(__testReadForegroundCatchUpForTests().pollTimerActive, true);
    emitNative(true);
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), before);
    assert.equal(refreshCalls.length, refreshes);
    assert.equal(__testReadForegroundCatchUpForTests().syncTickCalls, ticks);
  });

  it("4. double signal navigateur et natif : un seul cycle", async () => {
    await pauseThen(() => {
      show();
      emitNative(true);
    });
    assert.equal(resubscribeMock.mock.callCount(), 1);
    assert.equal(refreshCalls.length, 1);
    assert.equal(__testReadForegroundCatchUpForTests().again, null);
    assert.equal(__testReadForegroundCatchUpForTests().phase, "running");
  });

  it("5. plusieurs isActive true sans nouvelle pause : aucun cycle redondant", async () => {
    await pauseThen(() => emitNative(true));
    assert.equal(refreshCalls.length, 1);
    refreshCalls[0].resolve();
    await flush();
    emitNative(true);
    emitNative(true);
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 1);
    assert.equal(refreshCalls.length, 1);
  });

  it("6. nouveau retour pendant le refresh : cycle différé sur le snapshot le plus récent", async () => {
    await pauseThen(() => show());
    assert.equal(refreshCalls.length, 1);
    const generationBefore = getLobbyRuntimeGeneration();
    hide();
    show();
    const firstAgain = __testReadForegroundCatchUpForTests().again;
    assert.equal(firstAgain.lobbyId, LOBBY_A);
    assert.equal(firstAgain.generation, generationBefore);
    bumpLobbyRuntimeGeneration();
    hide();
    show();
    const latest = __testReadForegroundCatchUpForTests().again;
    assert.equal(latest.generation, getLobbyRuntimeGeneration());
    assert.notEqual(latest.generation, firstAgain.generation);
    assert.equal(resubscribeMock.mock.callCount(), 1);
    refreshCalls[0].resolve();
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 2);
    assert.equal(refreshCalls.length, 2);
    assert.equal(__testReadForegroundCatchUpForTests().phase, "running");
  });

  it("7. masquage avant le finally, sans retour plus récent : pas de cycle différé", async () => {
    await pauseThen(() => show());
    hide();
    show();
    assert.ok(__testReadForegroundCatchUpForTests().again);
    hide();
    refreshCalls[0].resolve();
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 1);
    assert.equal(refreshCalls.length, 1);
    assert.equal(__testReadForegroundCatchUpForTests().phase, "idle");
    show();
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 2);
    assert.equal(refreshCalls.length, 2);
  });

  it("8. id ou génération changés avant resouscription : aucun appel de l'ancien snapshot", async () => {
    await boot();
    hide();
    show();
    bumpLobbyRuntimeGeneration();
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 0);
    assert.equal(refreshCalls.length, 0);
    assert.equal(__testReadForegroundCatchUpForTests().phase, "idle");

    __testResetSyncVisibilityForTests();
    visibilityListeners.clear();
    initMultiplayerSyncVisibility();
    await flush();
    enterLobby(LOBBY_A);
    hide();
    show();
    enterLobby(LOBBY_B);
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 0);
    assert.equal(refreshCalls.length, 0);
    assert.equal(getState().inLobby, true);
    assert.equal(getState().lobby.id, LOBBY_B);
  });

  it("9. échec d'import puis échec de refresh : verrou libéré, un log, lobby conservé", async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
    };
    try {
      __testSetForegroundLobbyImporterForTests(async () => {
        throw new Error("import-down");
      });
      await pauseThen(() => show());
      assert.equal(__testReadForegroundCatchUpForTests().phase, "idle");
      assert.equal(getState().inLobby, true);
      assert.equal(getState().lobby.id, LOBBY_A);
      assert.equal(warnings.filter((args) => args[0] === "[MP-RT] catch-up failed").length, 1);
      assert.equal(resubscribeMock.mock.callCount(), 0);

      warnings.length = 0;
      __testResetSyncVisibilityForTests();
      visibilityListeners.clear();
      initMultiplayerSyncVisibility();
      await flush();
      enterLobby(LOBBY_A);
      __testSetForegroundLobbyImporterForTests(async () => ({
        resubscribeLobbyRealtime: resubscribeMock,
        refreshLobbyFromSupabase: async () => {
          throw new Error("refresh-down");
        },
        getLobbyRealtimeMeta: () => ({ gen: 4, status: "error" }),
        isJoinSessionHydrating: () => false,
      }));
      hide();
      show();
      await flush();
      assert.equal(resubscribeMock.mock.callCount(), 1);
      assert.equal(__testReadForegroundCatchUpForTests().phase, "idle");
      assert.equal(getState().inLobby, true);
      assert.equal(getState().lobby.id, LOBBY_A);
      const logged = warnings.filter((args) => args[0] === "[MP-RT] catch-up failed");
      assert.equal(logged.length, 1);
      assert.equal(logged[0][1].attempt, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("10. isActive false seul : ni pause ni modification du timer", async () => {
    await pauseThen(() => show());
    refreshCalls[0].resolve();
    await flush();
    const before = __testReadForegroundCatchUpForTests();
    assert.equal(before.paused, false);
    assert.equal(before.pollTimerActive, true);
    const timersBefore = intervalIds.size;
    const resubscribes = resubscribeMock.mock.callCount();
    emitNative(false);
    await flush();
    const after = __testReadForegroundCatchUpForTests();
    assert.equal(after.paused, false);
    assert.equal(after.pollTimerActive, true);
    assert.equal(intervalIds.size, timersBefore);
    assert.equal(resubscribeMock.mock.callCount(), resubscribes);
  });

  it("11-AB. finally obsolète ne touche pas au successeur", async () => {
    await pauseThen(() => show());
    assert.equal(refreshCalls.length, 1);
    const tokenA = __testReadForegroundCatchUpForTests().cycleToken;

    hide();
    show();
    const snapshotB = __testReadForegroundCatchUpForTests().again;
    assert.equal(snapshotB.lobbyId, LOBBY_A);
    assert.equal(__testReadForegroundCatchUpForTests().pollTimerActive, true);
    assert.equal(resubscribeMock.mock.callCount(), 1);

    refreshCalls[0].resolve();
    await flush();
    assert.equal(refreshCalls.length, 2);
    assert.equal(resubscribeMock.mock.callCount(), 2);
    const whileB = __testReadForegroundCatchUpForTests();
    assert.equal(whileB.phase, "running");
    assert.notEqual(whileB.cycleToken, tokenA);
    assert.equal(whileB.again, null);

    hide();
    show();
    const duringB = __testReadForegroundCatchUpForTests();
    assert.equal(duringB.phase, "running");
    assert.equal(duringB.cycleToken, whileB.cycleToken);
    assert.equal(duringB.again.lobbyId, LOBBY_A);
    assert.equal(duringB.again.generation, snapshotB.generation);
    assert.equal(resubscribeMock.mock.callCount(), 2);
    assert.equal(refreshCalls.length, 2);

    refreshCalls[1].resolve();
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 3);
    assert.equal(refreshCalls.length, 3);
    assert.equal(__testReadForegroundCatchUpForTests().phase, "running");
    assert.notEqual(__testReadForegroundCatchUpForTests().cycleToken, whileB.cycleToken);
  });

  it("12. le helper n'appelle pas subscribeLobbyRealtime ni removeChannel", async () => {
    const cycleBlock = gameSyncSrc.match(/async function runForegroundCatchUp[\s\S]*?^}/m)?.[0] || "";
    const resumeBlock =
      gameSyncSrc.match(/function resumeMultiplayerSyncAfterForeground[\s\S]*?^}/m)?.[0] || "";
    assert.doesNotMatch(cycleBlock, /subscribeLobbyRealtime\(/);
    assert.doesNotMatch(cycleBlock, /removeChannel\(/);
    assert.doesNotMatch(resumeBlock, /subscribeLobbyRealtime\(/);
    assert.doesNotMatch(resumeBlock, /removeChannel\(/);
    await pauseThen(() => show());
    refreshCalls[0].resolve();
    await flush();
    assert.equal(subscribeLobbyRealtimeMock.mock.callCount(), 0);
    assert.equal(removeChannelMock.mock.callCount(), 0);
    assert.equal(resubscribeMock.mock.callCount(), 1);
  });

  it("singleton : un second init n'enregistre pas un second listener", async () => {
    await boot();
    initMultiplayerSyncVisibility();
    await flush();
    assert.equal(addListenerCalls, 1);
    assert.equal(visibilityListeners.size, 1);
    hide();
    show();
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 1);
  });

  it("quitter le lobby avant le réseau n'émet pas de resouscription", async () => {
    await boot();
    hide();
    show();
    leaveLobbyState();
    await flush();
    assert.equal(resubscribeMock.mock.callCount(), 0);
    assert.equal(refreshCalls.length, 0);
    assert.equal(getState().inLobby, false);
  });
});
