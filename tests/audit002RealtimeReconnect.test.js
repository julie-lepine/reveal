/**
 * AUDIT-002 — reconnect Realtime : removeChannel avant abandon de ref + garde stale postgres_changes.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  bumpLobbyRuntimeGeneration,
  __resetLobbyRuntimeGenerationForTests,
} from "../js/core/lobbyRuntime.js";

const LOBBY_ID = "lobby-audit-002";
const SESSION_ROW = {
  id: "sess-1",
  lobby_id: LOBBY_ID,
  screen: "hottake",
  state: { hotTake: { phase: "vote" } },
};

const channels = [];
const removedChannels = [];
const applyRemoteSessionMock = mock.fn();
const handleSessionRouteMock = mock.fn();
const pulseGameSessionRealtimeMock = mock.fn();
const getCachedGameSessionMock = mock.fn(() => SESSION_ROW);
const getStateMock = mock.fn(() => ({
  inLobby: true,
  lobby: { id: LOBBY_ID, status: "waiting", gameId: null, hostId: "host-1", participants: [] },
}));

function makeChannel(topic) {
  const tableHandlers = Object.create(null);
  const ch = {
    topic,
    __lobbySubscribeCallCount: 0,
    __intentionalClose: false,
    __statusCb: null,
    on(_type, cfg, cb) {
      const table = cfg?.table || "*";
      if (!tableHandlers[table]) tableHandlers[table] = [];
      tableHandlers[table].push(cb);
      return ch;
    },
    subscribe(cb) {
      ch.__statusCb = cb;
      ch.__lobbySubscribeCallCount += 1;
      queueMicrotask(() => {
        if (!ch.__intentionalClose) cb("SUBSCRIBED");
      });
      return ch;
    },
    _emitStatus(status, err) {
      ch.__statusCb?.(status, err);
    },
    async _emitPostgres(table, payload) {
      const list = tableHandlers[table] || [];
      for (const cb of list) {
        await cb(payload);
      }
    },
  };
  channels.push(ch);
  return ch;
}

async function removeChannel(ch) {
  removedChannels.push(ch);
  const idx = channels.indexOf(ch);
  if (idx >= 0) channels.splice(idx, 1);
  // Simule realtime-js : CLOSED après remove (volontaire)
  ch.__statusCb?.("CLOSED");
}

const supabaseMock = {
  channel: (topic) => makeChannel(topic),
  removeChannel,
  getChannels: () => channels.slice(),
  realtime: { connectionState: () => "open" },
};

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    supabase: supabaseMock,
    isSupabaseConfigured: () => true,
  },
});

mock.module("../js/core/gameSync.js", {
  namedExports: {
    applyRemoteSession: applyRemoteSessionMock,
    handleSessionRoute: handleSessionRouteMock,
    refreshGameSession: mock.fn(async () => SESSION_ROW),
    getCachedGameSession: getCachedGameSessionMock,
    isActiveGameSessionScreen: () => false,
    nudgeSessionListenersForActingHost: mock.fn(),
    getActingHostUserId: () => null,
    clearCachedGameSessionUnlessForLobby: mock.fn(),
    pulseGameSessionRealtime: pulseGameSessionRealtimeMock,
    startMultiplayerSync: mock.fn(),
  },
});

mock.module("../js/core/state.js", {
  namedExports: {
    getState: getStateMock,
    saveStatePatch: mock.fn(),
    ensurePlayerScore: mock.fn(),
    replaceEveningScoreMaps: mock.fn(),
    getLocalDisplayName: () => "Player",
    getLocalEmoji: () => "🎮",
  },
});

mock.module("../js/core/router.js", {
  namedExports: {
    getCurrentScreen: () => "lobby",
    navigate: mock.fn(),
  },
});

mock.module("../js/core/supabaseAuth.js", {
  namedExports: {
    getSupabaseUserId: () => "user-test",
    ensureAnonymousSessionForRecovery: async () => {},
  },
});

mock.module("../js/core/guestMembership.js", {
  namedExports: {
    saveGuestMembership: mock.fn(),
    membershipFromBundle: mock.fn(),
    loadGuestMembership: () => null,
    clearGuestMembership: mock.fn(),
    canUseGuestMembershipRecovery: () => false,
  },
});

mock.module("../js/core/supabaseGame.js", {
  namedExports: {
    fetchGameSessionByLobby: async () => null,
  },
});

mock.module("../js/core/lobbyBoundary.js", {
  namedExports: {
    resolveSessionRestoreOutcome: () => ({ status: "none" }),
  },
});

mock.module("../js/core/lobbyMembershipAlign.js", {
  namedExports: {
    alignMembershipSnapshotAfterLobbyHydration: mock.fn(),
    MEMBERSHIP_HYDRATION_SOURCE: { REFRESH_CONFIRMED: "refresh" },
  },
});

mock.module("../js/core/lobbyMembershipUniqueConflict.js", {
  namedExports: { isLobbyMembersOneLivingPerUserConflict: () => false },
});

mock.module("../js/core/lobbyMembershipFetch.js", {
  namedExports: {
    queryActiveLobbyMembership: async () => ({ status: "none" }),
    fetchLivingMembershipRowsForUser: async () => ({ ok: true, rows: [] }),
    normalizePostgrestMembershipData: mock.fn(),
    normalizePostgrestMembershipRow: mock.fn(),
    ACTIVE_MEMBERSHIP_QUERY_LIMIT: 5,
  },
});

mock.module("../js/core/lobbyMembershipSnapshot.js", {
  namedExports: {
    invalidateMembershipSnapshot: mock.fn(),
    getMembershipSnapshot: () => null,
    setMembershipSnapshot: mock.fn(),
    getMembershipAuthGeneration: () => 0,
  },
});

mock.module("../js/core/lobbyCreateGuard.js", {
  namedExports: {
    applyMembershipQueryToSnapshot: mock.fn(),
  },
});

mock.module("../js/core/lobbyDissolveContract.js", {
  namedExports: {
    LOBBY_DISSOLVE_STATUS: {},
    mapDissolveLobbyRpcData: mock.fn(),
    interpretDissolveMembershipRequery: mock.fn(),
  },
});

mock.module("../js/core/lobbyLeaveContract.js", {
  namedExports: {
    validateLeaveLobbySupabaseIdentity: () => ({ ok: true }),
  },
});

mock.module("../js/core/lobbyMembershipDelete.js", {
  namedExports: {
    deleteOwnLobbyMembershipByIdWithDeps: mock.fn(),
  },
});

mock.module("../js/core/lobbyJoinEffects.js", {
  namedExports: {
    createLobbyJoinEffects: () => ({}),
    recordGuestMembershipWriteForJoin: mock.fn(),
    recordMembershipInsertForJoin: mock.fn(),
    recordMembershipReclaimForJoin: mock.fn(),
    recordPreexistingMembershipForJoin: mock.fn(),
  },
});

mock.module("../js/core/hostPresence.js", {
  namedExports: {
    detectActingHostTransition: () => null,
    resolveActingHostUserId: () => null,
  },
});

mock.module("../js/core/rosterRenameMigrate.js", {
  namedExports: {
    detectParticipantRenames: () => [],
    migrateEveningMapsForRosterRenames: mock.fn(),
  },
});

mock.module("../js/core/arch03ActingHostDebug.js", {
  namedExports: {
    arch03AhLog: () => {},
    arch03AhHostAgeMs: () => 0,
  },
});

mock.module("../js/core/lobbyHeartbeat.js", {
  namedExports: {
    startLobbyHeartbeat: mock.fn(() => () => {}),
  },
});

mock.module("../js/core/presenceUiLive.js", {
  namedExports: {
    arch03LiveLog: () => {},
    computeClaimEligible: () => false,
    hostAgeMs: () => 0,
    isHostPresentAt: () => true,
    shouldNudgeClaimHubUi: () => false,
  },
});

mock.module("../js/core/joinSessionHydrate.js", {
  namedExports: {
    JOIN_SESSION_RESTORE_DELAYS_MS: [0],
    SUBSCRIBED_ROUTE_DEBOUNCE_MS: 0,
    shouldRouteAfterRealtimeSubscribed: () => true,
    createDebouncedCallback: (fn) => ({
      schedule: (arg) => fn(arg),
      cancel: () => {},
    }),
    planLobbyJoinSyncOrder: () => [],
  },
});

mock.module("../js/core/lobby.js", {
  namedExports: {
    resolveLobbyClosureAndExit: mock.fn(async () => {}),
    handleKickedFromLobby: mock.fn(),
  },
});

mock.module("../js/core/lobbyClosureSession.js", {
  namedExports: {
    wasLobbyClosureHandled: () => false,
    isLocalHostManualDissolve: () => false,
  },
});

const {
  subscribeLobbyRealtime,
  unsubscribeLobbyRealtime,
  resubscribeLobbyRealtime,
  getLobbyRealtimeMeta,
  __testPatchSubscribedCatchUpLobbyState,
  __testResetSubscribedCatchUpInFlightForTests,
} = await import("../js/core/supabaseLobby.js");

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function resetLobbyRealtimeState() {
  unsubscribeLobbyRealtime({ reason: "test-reset" });
  channels.length = 0;
  removedChannels.length = 0;
  applyRemoteSessionMock.mock.resetCalls();
  handleSessionRouteMock.mock.resetCalls();
  pulseGameSessionRealtimeMock.mock.resetCalls();
  getCachedGameSessionMock.mock.mockImplementation(() => SESSION_ROW);
  getStateMock.mock.mockImplementation(() => ({
    inLobby: true,
    lobby: {
      id: LOBBY_ID,
      status: "waiting",
      gameId: null,
      hostId: "host-1",
      participants: [],
    },
  }));
  __testResetSubscribedCatchUpInFlightForTests();
  __testPatchSubscribedCatchUpLobbyState({
    presenceLobbyId: LOBBY_ID,
    lobbyChannelGen: 0,
    lobbyChannelLobbyId: null,
    lobbyRealtimeStatus: "idle",
    joinSessionHydrating: false,
    realtimeChannel: null,
    realtimeReconnectAttempts: 0,
  });
}

async function subscribeFresh() {
  subscribeLobbyRealtime(() => {});
  await flushMicrotasks();
  assert.equal(channels.length, 1);
  assert.equal(getLobbyRealtimeMeta().status, "subscribed");
  return channels[0];
}

async function emitErrorAndReconnect(channel, status) {
  channel._emitStatus(status, { message: `mock-${status}` });
  assert.equal(getLobbyRealtimeMeta().status, "error");
  mock.timers.tick(1000);
  await flushMicrotasks();
}

describe("AUDIT-002 realtime reconnect lifecycle", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
    __resetLobbyRuntimeGenerationForTests();
    bumpLobbyRuntimeGeneration(LOBBY_ID);
    resetLobbyRealtimeState();
  });

  afterEach(() => {
    unsubscribeLobbyRealtime({ reason: "test-teardown" });
    mock.timers.reset();
  });

  it("1. CHANNEL_ERROR → removeChannel(A) puis channel B", async () => {
    const channelA = await subscribeFresh();
    await emitErrorAndReconnect(channelA, "CHANNEL_ERROR");

    assert.ok(removedChannels.includes(channelA), "removeChannel(A) avant abandon");
    assert.equal(channels.length, 1);
    assert.notEqual(channels[0], channelA);
    assert.equal(getLobbyRealtimeMeta().status, "subscribed");
  });

  it("2. TIMED_OUT → removeChannel(A) puis channel B", async () => {
    const channelA = await subscribeFresh();
    await emitErrorAndReconnect(channelA, "TIMED_OUT");

    assert.ok(removedChannels.includes(channelA));
    assert.equal(channels.length, 1);
    assert.notEqual(channels[0], channelA);
  });

  it("3. CLOSED (non intentionnel) → removeChannel(A) puis channel B", async () => {
    const channelA = await subscribeFresh();
    await emitErrorAndReconnect(channelA, "CLOSED");

    assert.ok(removedChannels.includes(channelA));
    assert.equal(channels.length, 1);
    assert.notEqual(channels[0], channelA);
  });

  it("4. après reconnect, getChannels() ne garde qu'un channel lobby", async () => {
    const channelA = await subscribeFresh();
    await emitErrorAndReconnect(channelA, "CHANNEL_ERROR");

    const topics = supabaseMock.getChannels().map((c) => c.topic);
    assert.deepEqual(topics, [`lobby:${LOBBY_ID}`]);
    assert.equal(supabaseMock.getChannels().includes(channelA), false);
  });

  it("5. stale postgres game_sessions ignoré ; live appliqué", async () => {
    const channelA = await subscribeFresh();
    await emitErrorAndReconnect(channelA, "CHANNEL_ERROR");
    const channelB = channels[0];

    applyRemoteSessionMock.mock.resetCalls();
    await channelA._emitPostgres("game_sessions", {
      eventType: "UPDATE",
      new: { ...SESSION_ROW, state: { hotTake: { phase: "reveal" } } },
    });
    await flushMicrotasks();
    assert.equal(applyRemoteSessionMock.mock.callCount(), 0, "stale A ignoré");

    await channelB._emitPostgres("game_sessions", {
      eventType: "UPDATE",
      new: { ...SESSION_ROW, state: { hotTake: { phase: "reveal" } } },
    });
    await flushMicrotasks();
    assert.equal(applyRemoteSessionMock.mock.callCount(), 1, "live B traité");
  });

  it("6. stale event ne déclenche pas handleSessionRoute", async () => {
    const channelA = await subscribeFresh();
    await emitErrorAndReconnect(channelA, "CHANNEL_ERROR");
    const channelB = channels[0];

    handleSessionRouteMock.mock.resetCalls();
    await channelA._emitPostgres("game_sessions", {
      eventType: "UPDATE",
      new: { ...SESSION_ROW, state: { hotTake: { phase: "vote" } } },
    });
    await flushMicrotasks();
    assert.equal(handleSessionRouteMock.mock.callCount(), 0);

    await channelB._emitPostgres("game_sessions", {
      eventType: "UPDATE",
      new: { ...SESSION_ROW, state: { hotTake: { phase: "vote" } } },
    });
    await flushMicrotasks();
    assert.equal(handleSessionRouteMock.mock.callCount(), 1);
    assert.equal(
      handleSessionRouteMock.mock.calls[0].arguments[1]?.debugSource,
      "supabaseLobby/realtime/handle"
    );
  });

  it("7. resubscribeLobbyRealtime remove puis nouveau channel", async () => {
    const channelA = await subscribeFresh();
    resubscribeLobbyRealtime();
    await flushMicrotasks();

    assert.ok(removedChannels.includes(channelA));
    assert.equal(channels.length, 1);
    assert.notEqual(channels[0], channelA);
    assert.equal(getLobbyRealtimeMeta().status, "subscribed");
  });

  it("8. double CHANNEL_ERROR → un seul reconnect / un channel", async () => {
    const channelA = await subscribeFresh();
    channelA._emitStatus("CHANNEL_ERROR", { message: "e1" });
    channelA._emitStatus("CHANNEL_ERROR", { message: "e2" });
    mock.timers.tick(1000);
    await flushMicrotasks();

    assert.equal(removedChannels.filter((c) => c === channelA).length, 1);
    assert.equal(channels.length, 1);
    assert.equal(getLobbyRealtimeMeta().status, "subscribed");
  });

  it("9. reconnect timer + foreground resubscribe → timer stale no-op", async () => {
    const channelA = await subscribeFresh();
    channelA._emitStatus("CHANNEL_ERROR", { message: "race" });
    assert.equal(getLobbyRealtimeMeta().status, "error");

    // Foreground avant tick du timer (unsubscribe clear le timer)
    resubscribeLobbyRealtime();
    await flushMicrotasks();
    const channelAfterFg = channels[0];
    assert.notEqual(channelAfterFg, channelA);
    assert.equal(getLobbyRealtimeMeta().status, "subscribed");

    const buildsBeforeTick = channels.length;
    const removedBeforeTick = removedChannels.length;
    mock.timers.tick(1000);
    await flushMicrotasks();

    assert.equal(channels.length, buildsBeforeTick, "pas de 3e channel");
    assert.equal(removedChannels.length, removedBeforeTick, "channel FG non détruit");
    assert.equal(channels[0], channelAfterFg);
    assert.equal(getLobbyRealtimeMeta().status, "subscribed");
  });
});
