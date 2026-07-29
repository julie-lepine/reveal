/**
 * ARCH-07 — catch-up Realtime P0 (SUBSCRIBED + contrats source).
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bumpLobbyRuntimeGeneration,
  __resetLobbyRuntimeGenerationForTests,
} from "../js/core/lobbyRuntime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const supabaseLobbySrc = readFileSync(
  join(__dirname, "../js/core/supabaseLobby.js"),
  "utf8"
).replace(/\r\n/g, "\n");
const gameSyncSrc = readFileSync(
  join(__dirname, "../js/core/gameSync.js"),
  "utf8"
).replace(/\r\n/g, "\n");

const SESSION_ROW = { id: "sess-1", lobby_id: "lobby-1", screen: "speedvote-prep" };
const LOBBY_ID = "lobby-1";
const CHANNEL_GEN = 3;

const refreshGameSessionMock = mock.fn(async () => SESSION_ROW);
const handleSessionRouteMock = mock.fn();
const getStateMock = mock.fn(() => ({ inLobby: true, lobby: { id: LOBBY_ID } }));

let scheduleThrows = false;

mock.module("../js/core/joinSessionHydrate.js", {
  exports: {
    JOIN_SESSION_RESTORE_DELAYS_MS: [100, 350, 800, 1500],
    SUBSCRIBED_ROUTE_DEBOUNCE_MS: 300,
    shouldRouteAfterRealtimeSubscribed: ({ joinSessionHydrating }) => !joinSessionHydrating,
    createDebouncedCallback: (fn) => ({
      schedule: (arg) => {
        if (scheduleThrows) throw new Error("schedule_route_fail");
        fn(arg);
      },
      cancel: () => {},
    }),
    planLobbyJoinSyncOrder: () => ["restoreActiveGameSession", "startMultiplayerSync"],
  },
});

mock.module("../js/core/gameSync.js", {
  exports: {
    applyRemoteSession: mock.fn(),
    handleSessionRoute: handleSessionRouteMock,
    refreshGameSession: refreshGameSessionMock,
    getCachedGameSession: () => null,
    isActiveGameSessionScreen: () => false,
    nudgeSessionListenersForActingHost: mock.fn(),
    getActingHostUserId: () => null,
    clearCachedGameSessionUnlessForLobby: mock.fn(),
  },
});

mock.module("../js/core/state.js", {
  exports: {
    getState: getStateMock,
    saveStatePatch: mock.fn(),
    ensurePlayerScore: mock.fn(),
    replaceEveningScoreMaps: mock.fn(),
    getLocalDisplayName: () => "Player",
    getLocalEmoji: () => "🎮",
  },
});

mock.module("../js/core/router.js", {
  exports: {
    getCurrentScreen: () => "game-select",
    navigate: mock.fn(),
  },
});

mock.module("../js/core/supabaseClient.js", {
  exports: {
    supabase: {
      channel: () => ({
        on() {
          return this;
        },
        subscribe: () => {},
      }),
      removeChannel: () => {},
      getChannels: () => [],
      realtime: { connectionState: () => null },
    },
    isSupabaseConfigured: () => false,
  },
});

mock.module("../js/core/supabaseAuth.js", {
  exports: {
    getSupabaseUserId: () => "user-test",
    ensureAnonymousSessionForRecovery: async () => {},
  },
});

mock.module("../js/core/guestMembership.js", {
  exports: {
    saveGuestMembership: mock.fn(),
    membershipFromBundle: mock.fn(),
    loadGuestMembership: () => null,
    clearGuestMembership: mock.fn(),
    canUseGuestMembershipRecovery: () => false,
  },
});

mock.module("../js/core/supabaseGame.js", {
  exports: {
    fetchGameSessionByLobby: async () => null,
  },
});

mock.module("../js/core/lobbyBoundary.js", {
  exports: {
    resolveSessionRestoreOutcome: () => ({ status: "none" }),
  },
});

mock.module("../js/core/lobbyMembershipAlign.js", {
  exports: {
    alignMembershipSnapshotAfterLobbyHydration: mock.fn(),
    MEMBERSHIP_HYDRATION_SOURCE: { REFRESH_CONFIRMED: "refresh" },
  },
});

mock.module("../js/core/lobbyMembershipUniqueConflict.js", {
  exports: { isLobbyMembersOneLivingPerUserConflict: () => false },
});

mock.module("../js/core/lobbyMembershipFetch.js", {
  exports: {
    queryActiveLobbyMembership: async () => ({ status: "none" }),
    fetchLivingMembershipRowsForUser: async () => ({ ok: true, rows: [] }),
    normalizePostgrestMembershipData: mock.fn(),
    normalizePostgrestMembershipRow: mock.fn(),
    ACTIVE_MEMBERSHIP_QUERY_LIMIT: 5,
  },
});

mock.module("../js/core/lobbyMembershipSnapshot.js", {
  exports: {
    invalidateMembershipSnapshot: mock.fn(),
    getMembershipSnapshot: () => null,
    setMembershipSnapshot: mock.fn(),
    getMembershipAuthGeneration: () => 0,
  },
});

mock.module("../js/core/lobbyCreateGuard.js", {
  exports: { applyMembershipQueryToSnapshot: mock.fn() },
});

mock.module("../js/core/lobbyDissolveContract.js", {
  exports: {
    LOBBY_DISSOLVE_STATUS: {},
    mapDissolveLobbyRpcData: mock.fn(),
    interpretDissolveMembershipRequery: mock.fn(),
  },
});

mock.module("../js/core/lobbyJoinEffects.js", {
  exports: {
    createLobbyJoinEffects: () => ({}),
    recordGuestMembershipWriteForJoin: mock.fn(),
    recordMembershipInsertForJoin: mock.fn(),
    recordMembershipReclaimForJoin: mock.fn(),
    recordPreexistingMembershipForJoin: mock.fn(),
  },
});

mock.module("../js/core/hostPresence.js", {
  exports: {
    detectActingHostTransition: () => false,
    resolveActingHostUserId: () => null,
  },
});

mock.module("../js/core/rosterRenameMigrate.js", {
  exports: {
    detectParticipantRenames: () => [],
    migrateEveningMapsForRosterRenames: mock.fn(),
  },
});

mock.module("../js/core/arch03ActingHostDebug.js", {
  exports: { arch03AhLog: mock.fn(), arch03AhHostAgeMs: () => 0 },
});

mock.module("../js/config/syncConfig.js", {
  exports: { scalePollIntervalMs: (ms) => ms },
});

mock.module("../js/config/lobbyLifecycle.js", {
  exports: {
    LOBBY_EXPIRED_JOIN_MSG: "",
    LOBBY_FULL_MSG: "",
    LOBBY_HEARTBEAT_MIN_MS: 5000,
    HOST_PRESENCE_STALE_MS: 120000,
    HOST_TRANSFER_STALE_MS: 300000,
    MAX_PLAYERS: 12,
    isLobbyJoinTooOld: () => false,
  },
});

mock.module("../js/core/lobbyHeartbeat.js", {
  exports: { startLobbyHeartbeat: mock.fn() },
});

mock.module("../js/core/presenceUiLive.js", {
  exports: {
    arch03LiveLog: mock.fn(),
    computeClaimEligible: () => false,
    hostAgeMs: () => 0,
    isHostPresentAt: () => true,
    shouldNudgeClaimHubUi: () => false,
  },
});

const {
  runSubscribedSessionCatchUp,
  __testResetSubscribedCatchUpInFlightForTests,
  __testPatchSubscribedCatchUpLobbyState,
  __testLogMpRtCatchUpFailure,
  __testNormalizeCatchUpErrorForLog,
} = await import("../js/core/supabaseLobby.js");

function seedValidCatchUpState(overrides = {}) {
  const channel = { topic: `lobby:${LOBBY_ID}`, __lobbyGen: CHANNEL_GEN };
  __testPatchSubscribedCatchUpLobbyState({
    presenceLobbyId: LOBBY_ID,
    lobbyChannelGen: CHANNEL_GEN,
    lobbyChannelLobbyId: LOBBY_ID,
    lobbyRealtimeStatus: "subscribed",
    joinSessionHydrating: false,
    realtimeChannel: channel,
    ...overrides,
  });
}

function findMpRtWarn(warnings, { stage, attempt } = {}) {
  return warnings.find(
    (entry) =>
      entry[0] === "[MP-RT] catch-up failed" &&
      entry[1]?.event === "mp_rt_catchup_failed" &&
      (stage == null || entry[1]?.stage === stage) &&
      (attempt == null || entry[1]?.attempt === attempt)
  );
}

function refreshSequence(...behaviors) {
  let call = 0;
  refreshGameSessionMock.mock.mockImplementation(async () => {
    const behavior = behaviors[call] ?? behaviors[behaviors.length - 1];
    call += 1;
    if (behavior instanceof Error) throw behavior;
    return behavior;
  });
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("ARCH-07 SUBSCRIBED catch-up", () => {
  /** @type {typeof console.warn} */
  let origWarn;
  /** @type {unknown[][]} */
  let warnings;

  beforeEach(() => {
    __resetLobbyRuntimeGenerationForTests();
    __testResetSubscribedCatchUpInFlightForTests();
    scheduleThrows = false;
    refreshGameSessionMock.mock.resetCalls();
    handleSessionRouteMock.mock.resetCalls();
    getStateMock.mock.mockImplementation(() => ({ inLobby: true, lobby: { id: LOBBY_ID } }));
    refreshGameSessionMock.mock.mockImplementation(async () => SESSION_ROW);
    seedValidCatchUpState();

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

  it("1. refresh initial réussi — aucun warning, routing conservé", async () => {
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(refreshGameSessionMock.mock.callCount(), 1);
    assert.equal(handleSessionRouteMock.mock.callCount(), 1);
    assert.equal(findMpRtWarn(warnings), undefined);
  });

  it("2. refresh rejeté puis retry réussi — warning attempt 1, deux refresh, un routing", async () => {
    refreshSequence(new Error("network"), SESSION_ROW);
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(refreshGameSessionMock.mock.callCount(), 2);
    assert.equal(handleSessionRouteMock.mock.callCount(), 1);
    assert.ok(findMpRtWarn(warnings, { stage: "refresh_session", attempt: 1 }));
    assert.equal(findMpRtWarn(warnings, { attempt: 2 }), undefined);
  });

  it("3. refresh initial et retry rejetés — deux refresh, deux warnings, pas de 3e", async () => {
    refreshSequence(new Error("fail-1"), new Error("fail-2"), new Error("fail-3"));
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(refreshGameSessionMock.mock.callCount(), 2);
    assert.equal(handleSessionRouteMock.mock.callCount(), 0);
    const attempts = warnings
      .filter((w) => w[0] === "[MP-RT] catch-up failed")
      .map((w) => w[1]?.attempt);
    assert.deepEqual(attempts, [1, 2]);
  });

  it("4. contexte stale après échec initial — warning 1, pas de retry ni routing", async () => {
    refreshGameSessionMock.mock.mockImplementation(async () => {
      __testPatchSubscribedCatchUpLobbyState({ presenceLobbyId: null });
      throw new Error("network");
    });
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(refreshGameSessionMock.mock.callCount(), 1);
    assert.equal(handleSessionRouteMock.mock.callCount(), 0);
    assert.ok(findMpRtWarn(warnings, { attempt: 1 }));
    assert.equal(findMpRtWarn(warnings, { attempt: 2 }), undefined);
  });

  it("5. contexte stale après retry réussi — pas de schedule tardif", async () => {
    refreshGameSessionMock.mock.mockImplementation(async () => {
      if (refreshGameSessionMock.mock.callCount() === 1) {
        throw new Error("network");
      }
      bumpLobbyRuntimeGeneration();
      return SESSION_ROW;
    });
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(handleSessionRouteMock.mock.callCount(), 0);
  });

  it("6. deux SUBSCRIBED même gen — une chaîne in-flight, deux refresh max", async () => {
    let inFlight = 0;
    refreshGameSessionMock.mock.mockImplementation(async () => {
      inFlight += 1;
      assert.ok(inFlight <= 1, "refresh concurrent");
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return SESSION_ROW;
    });
    const a = runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    const b = runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    await Promise.all([a, b]);
    assert.equal(refreshGameSessionMock.mock.callCount(), 1);
    assert.equal(handleSessionRouteMock.mock.callCount(), 1);
  });

  it("7. nouvelle génération — ancienne chaîne ne route pas, nouvelle exécute", async () => {
    let bumped = false;
    refreshGameSessionMock.mock.mockImplementation(async () => {
      if (!bumped) {
        bumped = true;
        __testPatchSubscribedCatchUpLobbyState({ lobbyChannelGen: CHANNEL_GEN + 1 });
      }
      return SESSION_ROW;
    });
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(handleSessionRouteMock.mock.callCount(), 0);

    handleSessionRouteMock.mock.resetCalls();
    refreshGameSessionMock.mock.mockImplementation(async () => SESSION_ROW);
    seedValidCatchUpState({ lobbyChannelGen: CHANNEL_GEN + 1 });
    await runSubscribedSessionCatchUp({
      lobbyId: LOBBY_ID,
      channelGeneration: CHANNEL_GEN + 1,
    });
    assert.equal(handleSessionRouteMock.mock.callCount(), 1);
  });

  it("8. row === null — aucun routing ni warning failure", async () => {
    refreshGameSessionMock.mock.mockImplementation(async () => null);
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(handleSessionRouteMock.mock.callCount(), 0);
    assert.equal(findMpRtWarn(warnings), undefined);
  });

  it("9. gate joinSessionHydrating fermée — pas de routing, refresh autorisé", async () => {
    __testPatchSubscribedCatchUpLobbyState({ joinSessionHydrating: true });
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(refreshGameSessionMock.mock.callCount(), 1);
    assert.equal(handleSessionRouteMock.mock.callCount(), 0);
  });

  it("10. erreur schedule_route — warning stage schedule_route, pas de retry réseau", async () => {
    scheduleThrows = true;
    await runSubscribedSessionCatchUp({ lobbyId: LOBBY_ID, channelGeneration: CHANNEL_GEN });
    assert.equal(refreshGameSessionMock.mock.callCount(), 1);
    assert.ok(findMpRtWarn(warnings, { stage: "schedule_route", attempt: 1 }));
  });

  it("11. aucun appel scheduleRealtimeReconnect dans le catch-up SUBSCRIBED", () => {
    const arch07Block =
      supabaseLobbySrc.match(
        /async function executeSubscribedSessionCatchUp[\s\S]*?^export async function runSubscribedSessionCatchUp/m
      )?.[0] || "";
    assert.ok(arch07Block.includes("executeSubscribedSessionCatchUp"));
    assert.doesNotMatch(arch07Block, /scheduleRealtimeReconnect/);
    assert.match(supabaseLobbySrc, /void runSubscribedSessionCatchUp\(/);
  });

  it("12. aucune alerte ou toast ajouté (contrat source)", () => {
    assert.doesNotMatch(supabaseLobbySrc, /runSubscribedSessionCatchUp[\s\S]*showAppAlert/);
    assert.doesNotMatch(supabaseLobbySrc, /logMpRtCatchUpFailure[\s\S]*showAppAlert/);
  });
});

describe("ARCH-07 contrats log SUBSCRIBED", () => {
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

  it("18. aucun payload session complet dans les logs", () => {
    __testLogMpRtCatchUpFailure(new Error("x"), {
      phase: "subscribed_catchup",
      stage: "refresh_session",
      attempt: 1,
      lobbyId: LOBBY_ID,
      channelGeneration: CHANNEL_GEN,
      subscriptionStatus: "subscribed",
      currentScreen: "game-select",
      joinSessionHydrating: false,
    });
    const payload = warnings[0]?.[1];
    assert.equal(payload.event, "mp_rt_catchup_failed");
    assert.equal(Object.hasOwn(payload, "state"), false);
    assert.equal(Object.hasOwn(payload, "row"), false);
    assert.equal(Object.hasOwn(payload, "participants"), false);
  });

  it("19. logger robuste — null, chaîne, objet non-Error", () => {
    assert.deepEqual(__testNormalizeCatchUpErrorForLog(null), {
      errorName: "Error",
      errorMessage: "null",
    });
    assert.deepEqual(__testNormalizeCatchUpErrorForLog("offline"), {
      errorName: "Error",
      errorMessage: "offline",
    });
    assert.deepEqual(__testNormalizeCatchUpErrorForLog({ code: 503 }), {
      errorName: "Error",
      errorMessage: '{"code":503}',
    });
    __testLogMpRtCatchUpFailure(undefined, {
      phase: "subscribed_catchup",
      stage: "refresh_session",
      attempt: 1,
      lobbyId: LOBBY_ID,
      channelGeneration: 1,
      subscriptionStatus: "subscribed",
      currentScreen: "lobby",
      joinSessionHydrating: false,
    });
    assert.equal(warnings[0]?.[0], "[MP-RT] catch-up failed");
    assert.equal(warnings[0]?.[1]?.errorMessage, "undefined");
  });

  it("20. préfixe et event exacts", () => {
    __testLogMpRtCatchUpFailure(new Error("e"), {
      phase: "subscribed_catchup",
      stage: "refresh_session",
      attempt: 2,
      lobbyId: LOBBY_ID,
      channelGeneration: 1,
      subscriptionStatus: "subscribed",
      currentScreen: "lobby",
      joinSessionHydrating: false,
    });
    assert.equal(warnings[0]?.[0], "[MP-RT] catch-up failed");
    assert.equal(warnings[0]?.[1]?.event, "mp_rt_catchup_failed");
  });
});

describe("ARCH-07 contrats source gameSync foreground", () => {
  const foregroundLogBlock =
    gameSyncSrc.match(/function logForegroundLobbyRefreshFailure[\s\S]*?^}/m)?.[0] || "";
  const visibilityBlock =
    gameSyncSrc.match(/export function initMultiplayerSyncVisibility[\s\S]*?^}/m)?.[0] || "";

  it("13. passage visible — refresh lobby toujours appelé", () => {
    assert.match(visibilityBlock, /m\.refreshLobbyFromSupabase\?\.\(\)\.catch\(/);
    assert.match(visibilityBlock, /logForegroundLobbyRefreshFailure/);
    assert.match(visibilityBlock, /resubscribeLobbyRealtime/);
    assert.match(visibilityBlock, /void syncTick\(\)/);
  });

  it("14. refresh lobby rejeté — log foreground (contrat source)", () => {
    assert.match(foregroundLogBlock, /phase: "foreground_refresh"/);
    assert.match(foregroundLogBlock, /stage: "refresh_lobby"/);
    assert.match(foregroundLogBlock, /attempt: 1/);
    assert.match(foregroundLogBlock, /\[MP-RT\] catch-up failed/);
  });

  it("15. aucun retry foreground (contrat source)", () => {
    assert.ok(foregroundLogBlock);
    assert.doesNotMatch(foregroundLogBlock, /attempt:\s*2/);
    assert.doesNotMatch(foregroundLogBlock, /setTimeout/);
  });

  it("16. resubscribe et syncTick restent dans le handler visibility", () => {
    assert.match(visibilityBlock, /m\.resubscribeLobbyRealtime/);
    assert.match(visibilityBlock, /void syncTick\(\)/);
  });

  it("17. aucune UI ajoutée foreground (contrat source)", () => {
    assert.doesNotMatch(foregroundLogBlock, /showAppAlert/);
    assert.doesNotMatch(visibilityBlock, /showAppAlert/);
  });
});
