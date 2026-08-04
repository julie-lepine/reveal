/**
 * ARCH-07 P1/P2 - observabilité résiduelle (gameResume, hostClaim, poll rebuild queue).
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPollChannelController } from "../js/core/lobbyPollChannel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lobbyPollChannelSrc = readFileSync(
  join(__dirname, "../js/core/lobbyPollChannel.js"),
  "utf8"
);

const refreshGameSessionMock = mock.fn();
const routeToSessionScreenMock = mock.fn();
const routeToActiveGameIfNeededMock = mock.fn();
const applyRemoteSessionMock = mock.fn();
const getCachedGameSessionMock = mock.fn(() => ({
  state: { hotTake: {} },
  screen: "hottake",
}));
const getCurrentScreenMock = mock.fn(() => "game-select");
const getStateMock = mock.fn(() => ({ lobby: { id: "lobby-1" } }));
const isGameSyncActiveMock = mock.fn(() => true);
const isLobbyHostMock = mock.fn(() => false);

const claimLobbyHostIfStaleSupabaseMock = mock.fn();
const refreshLobbyFromSupabaseMock = mock.fn();
const showAppAlertMock = mock.fn(async () => {});
const showClaimHostDialogMock = mock.fn(async () => true);
const getSupabaseUserIdMock = mock.fn();

mock.module("../js/core/gameSync.js", {
  exports: {
    clearSessionRouteSuppress: mock.fn(),
    applyRemoteSession: applyRemoteSessionMock,
    getCachedGameSession: getCachedGameSessionMock,
    getResumableSessionScreen: mock.fn(),
    isGameSyncActive: isGameSyncActiveMock,
    isLobbyHost: isLobbyHostMock,
    isOnGameSetupScreen: mock.fn(() => false),
    isResumableSessionDestination: mock.fn(() => true),
    refreshGameSession: refreshGameSessionMock,
    isSessionInProgressPlay: mock.fn(() => true),
    routeToActiveGameIfNeeded: routeToActiveGameIfNeededMock,
    routeToSessionScreen: routeToSessionScreenMock,
    suppressRoutingForScoreView: mock.fn(),
  },
});

mock.module("../js/core/resumeBannerDismiss.js", {
  exports: {
    clearResumeBannerDismiss: mock.fn(),
    dismissResumeBannerForSession: mock.fn(),
    shouldShowResumeBannerAfterDismiss: mock.fn(() => true),
    resumeBannerSessionKey: mock.fn(() => "game:hottake"),
    evaluateResumeBannerVisibility: mock.fn(() => true),
    getResumeBannerDismissedKey: mock.fn(() => null),
  },
});

mock.module("../js/core/router.js", {
  exports: {
    getCurrentScreen: getCurrentScreenMock,
    navigate: mock.fn(),
  },
});

mock.module("../js/core/state.js", {
  exports: {
    getState: getStateMock,
  },
});

mock.module("../js/core/supabaseLobby.js", {
  exports: {
    claimLobbyHostIfStaleSupabase: claimLobbyHostIfStaleSupabaseMock,
    refreshLobbyFromSupabase: refreshLobbyFromSupabaseMock,
  },
});

mock.module("../js/core/dialog.js", {
  exports: {
    showAppAlert: showAppAlertMock,
    showClaimHostDialog: showClaimHostDialogMock,
  },
});

mock.module("../js/core/supabaseAuth.js", {
  exports: {
    getSupabaseUserId: getSupabaseUserIdMock,
  },
});

mock.module("../js/screens/nav.js", {
  exports: {
    bindNav: mock.fn(),
  },
});

const { rejoinGameResumeTarget, __testLogGameResumeRefreshFailure } = await import(
  "../js/core/gameResume.js"
);
const { ensureLobbyHostOrOfferClaim, __testLogHostClaimRecoveryFailure } = await import(
  "../js/core/hostClaimOffer.js"
);

function findMpRtWarn(warnings) {
  return warnings.filter(
    (entry) => entry[0] === "[MP-RT] catch-up failed" && entry[1]?.event === "mp_rt_catchup_failed"
  );
}

function findPollRebuildWarn(warnings) {
  return warnings.filter(
    (entry) =>
      entry[0] === "[POLL-RT] rebuild failed" && entry[1]?.event === "poll_rt_rebuild_failed"
  );
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("ARCH-07 P2b gameResume", () => {
  /** @type {typeof console.warn} */
  let origWarn;
  /** @type {unknown[][]} */
  let warnings;

  beforeEach(() => {
    refreshGameSessionMock.mock.resetCalls();
    routeToSessionScreenMock.mock.resetCalls();
    routeToActiveGameIfNeededMock.mock.resetCalls();
    applyRemoteSessionMock.mock.resetCalls();
    getCurrentScreenMock.mock.mockImplementation(() => "game-select");
    getStateMock.mock.mockImplementation(() => ({ lobby: { id: "lobby-1" } }));

    warnings = [];
    origWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
      origWarn(...args);
    };
  });

  afterEach(() => {
    console.warn = origWarn;
  });

  it("refresh rejeté - routage immédiat conservé, log structuré, pas de second routage", async () => {
    refreshGameSessionMock.mock.mockImplementation(async () => {
      throw new Error("network down");
    });

    const result = await rejoinGameResumeTarget("hottake");

    assert.equal(result, true);
    assert.equal(routeToSessionScreenMock.mock.callCount(), 1);
    assert.deepEqual(routeToSessionScreenMock.mock.calls[0].arguments, [
      "hottake",
      { force: true },
    ]);
    assert.equal(applyRemoteSessionMock.mock.callCount(), 1);

    await flushMicrotasks();

    assert.equal(routeToActiveGameIfNeededMock.mock.callCount(), 0);
    const logged = findMpRtWarn(warnings);
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][1], {
      event: "mp_rt_catchup_failed",
      phase: "game_resume",
      stage: "refresh_session",
      attempt: 1,
      targetScreen: "hottake",
      currentScreen: "game-select",
      lobbyId: "lobby-1",
      errorName: "Error",
      errorMessage: "network down",
    });
  });

  it("refresh réussi - route vers session active sans warning", async () => {
    const row = { id: "s1", screen: "hottake-play" };
    refreshGameSessionMock.mock.mockImplementation(async () => row);

    const result = await rejoinGameResumeTarget("hottake");
    assert.equal(result, true);
    await flushMicrotasks();

    assert.equal(routeToActiveGameIfNeededMock.mock.callCount(), 1);
    assert.deepEqual(routeToActiveGameIfNeededMock.mock.calls[0].arguments, [
      row,
      { force: true, shouldContinue: null },
    ]);
    assert.equal(findMpRtWarn(warnings).length, 0);
  });

  it("logger robuste - erreur string", () => {
    /** @type {unknown[][]} */
    const captured = [];
    const prev = console.warn;
    console.warn = (...args) => captured.push(args);
    try {
      __testLogGameResumeRefreshFailure("network failed", { targetScreen: "dilemma" });
    } finally {
      console.warn = prev;
    }
    assert.equal(captured.length, 1);
    assert.equal(captured[0][1].errorMessage, "network failed");
    assert.equal(captured[0][1].phase, "game_resume");
  });

  it("logger robuste - null", () => {
    /** @type {unknown[][]} */
    const captured = [];
    const prev = console.warn;
    console.warn = (...args) => captured.push(args);
    try {
      __testLogGameResumeRefreshFailure(null, { targetScreen: "dilemma" });
    } finally {
      console.warn = prev;
    }
    assert.equal(captured[0][1].errorMessage, "null");
  });
});

describe("ARCH-07 P2a hostClaimOffer", () => {
  const hostId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const guestLow = "11111111-1111-1111-1111-111111111111";
  const staleLastSeen = new Date(Date.now() - 6 * 60 * 1000).toISOString();

  /** @type {typeof console.warn} */
  let origWarn;
  /** @type {unknown[][]} */
  let warnings;

  beforeEach(() => {
    claimLobbyHostIfStaleSupabaseMock.mock.resetCalls();
    refreshLobbyFromSupabaseMock.mock.resetCalls();
    showAppAlertMock.mock.resetCalls();
    showClaimHostDialogMock.mock.resetCalls();
    isGameSyncActiveMock.mock.mockImplementation(() => true);
    isLobbyHostMock.mock.mockImplementation(() => false);
    getSupabaseUserIdMock.mock.mockImplementation(() => guestLow);
    getStateMock.mock.mockImplementation(() => ({
      lobby: {
        hostId,
        participants: [
          { userId: hostId, isHost: true, lastSeenAt: staleLastSeen },
          { userId: guestLow, lastSeenAt: new Date().toISOString() },
        ],
      },
    }));
    getCurrentScreenMock.mock.mockImplementation(() => "game-select");

    warnings = [];
    origWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
      origWarn(...args);
    };
  });

  afterEach(() => {
    console.warn = origWarn;
  });

  it("claim refusé + refresh rejeté - log recovery, alerte claim inchangée", async () => {
    claimLobbyHostIfStaleSupabaseMock.mock.mockImplementation(async () => ({
      ok: false,
      error: "Transfert impossible côté serveur",
    }));
    refreshLobbyFromSupabaseMock.mock.mockImplementation(async () => {
      throw new Error("refresh lobby failed");
    });

    const result = await ensureLobbyHostOrOfferClaim({ reason: "test-launch" });

    assert.equal(result.ok, false);
    assert.equal(result.error, "Transfert impossible côté serveur");
    assert.equal(refreshLobbyFromSupabaseMock.mock.callCount(), 1);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    assert.match(String(showAppAlertMock.mock.calls[0].arguments[0]), /Transfert impossible/);

    const logged = findMpRtWarn(warnings);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1].phase, "host_claim_recovery");
    assert.equal(logged[0][1].stage, "refresh_lobby");
    assert.equal(logged[0][1].attempt, 1);
    assert.equal(logged[0][1].errorMessage, "refresh lobby failed");
  });

  it("claim refusé + refresh OK - aucun warning recovery", async () => {
    claimLobbyHostIfStaleSupabaseMock.mock.mockImplementation(async () => ({
      ok: false,
      error: "Host encore actif",
    }));
    refreshLobbyFromSupabaseMock.mock.mockImplementation(async () => {});

    await ensureLobbyHostOrOfferClaim();

    assert.equal(findMpRtWarn(warnings).length, 0);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    assert.match(String(showAppAlertMock.mock.calls[0].arguments[0]), /de nouveau actif/i);
  });

  it("logger recovery robuste - null", () => {
    /** @type {unknown[][]} */
    const captured = [];
    const prev = console.warn;
    console.warn = (...args) => captured.push(args);
    try {
      __testLogHostClaimRecoveryFailure(null);
    } finally {
      console.warn = prev;
    }
    assert.equal(captured[0][1].errorMessage, "null");
    assert.equal(captured[0][1].phase, "host_claim_recovery");
  });
});

describe("ARCH-07 P1 lobbyPollChannel rebuild queue", () => {
  /** @type {typeof console.warn} */
  let origWarn;
  /** @type {unknown[][]} */
  let warnings;

  beforeEach(() => {
    warnings = [];
    origWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
      origWarn(...args);
    };
  });

  afterEach(() => {
    console.warn = origWarn;
  });

  it("rebuild A rejette → demande B logue previous_chain et exécute rebuild B", async () => {
    let buildCount = 0;
    const builds = [];

    const mock = {
      createChannel(topic) {
        buildCount += 1;
        builds.push(topic);
        if (buildCount === 1) {
          throw new Error("rebuild A failed");
        }
        const listeners = { status: null };
        const ch = {
          topic: `realtime:${topic}`,
          state: "joining",
          __pollSubscribeCallCount: 0,
          on() {
            return ch;
          },
          subscribe(cb) {
            listeners.status = cb;
            queueMicrotask(() => {
              ch.state = "joined";
              cb("SUBSCRIBED");
            });
            return ch;
          },
          _emitStatus(status) {
            listeners.status?.(status);
          },
        };
        return ch;
      },
      async removeChannel() {},
    };

    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });

    await ctrl.requestRebuild("lobby-a", null, { reason: "boot_a" }).catch(() => {});
    await flushMicrotasks();

    await ctrl.requestRebuild("lobby-b", "poll-1", { reason: "boot_b" });
    await flushMicrotasks();

    const logged = findPollRebuildWarn(warnings);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1].phase, "poll_rebuild_queue");
    assert.equal(logged[0][1].stage, "previous_chain");
    assert.equal(logged[0][1].requestedLobbyId, "lobby-b");
    assert.equal(logged[0][1].requestedReason, "boot_b");
    assert.equal(logged[0][1].errorMessage, "rebuild A failed");

    assert.equal(builds.length, 2);
    assert.match(builds[1], /lobby-b/);
    assert.equal(ctrl.getState().channelLobbyId, "lobby-b");
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");
  });

  it("coalescing inflight inchangé après échec précédent", async () => {
    let buildCount = 0;
    const mock = {
      createChannel(topic) {
        buildCount += 1;
        if (buildCount === 1) throw new Error("first fail");
        return {
          topic: `realtime:${topic}`,
          state: "joining",
          __pollSubscribeCallCount: 0,
          on() {
            return this;
          },
          subscribe(cb) {
            queueMicrotask(() => cb("SUBSCRIBED"));
            return this;
          },
        };
      },
      async removeChannel() {},
    };

    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });

    const p1 = ctrl.requestRebuild("L", null, { reason: "a" });
    const p2 = ctrl.requestRebuild("L", null, { reason: "b" });
    assert.equal(p1, p2);

    await p2.catch(() => {});
    await flushMicrotasks();

    assert.equal(buildCount, 1);
  });
});

describe("ARCH-07 P1 contrats source", () => {
  it("requestRebuild n'utilise plus catch(() => {}) sur rebuildChain", () => {
    const fnStart = lobbyPollChannelSrc.indexOf("function requestRebuild");
    const fnEnd = lobbyPollChannelSrc.indexOf("async function rebuild", fnStart);
    assert.ok(fnStart >= 0 && fnEnd > fnStart);
    const body = lobbyPollChannelSrc.slice(fnStart, fnEnd);
    assert.match(body, /logPollRebuildChainFailure/);
    assert.doesNotMatch(body, /rebuildChain\s*=\s*rebuildChain\s*\r?\n\s*\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });
});
