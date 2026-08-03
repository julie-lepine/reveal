/**
 * ARCH-10 — invalidation précoce du cache session MP après sortie confirmée.
 *
 * Pas d’import de gameSync.js / lobby.js réels (cycle Node + named exports).
 * Preuve = miroir minimal du contrat cache + contrats source + leave injecté.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveStatePatch, getState } from "../js/core/state.js";
import {
  runVoluntaryMemberLeave,
  resetVoluntaryLeaveLockForTests,
} from "../js/core/voluntaryMemberLeave.js";
import { shouldExposeCachedSession } from "../js/core/lobbyBoundary.js";
import { commitMembershipRemoved } from "../js/core/lobbyMembershipAlign.js";
import {
  UID_A,
  resetMembershipSnapshotTestState,
} from "./helpers/membershipSnapshotTest.js";
import { __resetMembershipAuthForTests } from "../js/core/lobbyMembershipSnapshot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const SESSION_ROW = {
  lobby_id: "lobby-1",
  game_id: "guesslie",
  screen: "guesslie-menu",
  state: { guessLie: { phase: "prep" } },
};

/**
 * Miroir du contrat gameSync invalidate/clear/get/notify (ARCH-10).
 * Aligné sur clearCachedGameSession + invalidateCurrentLobbySessionCache.
 */
function createSessionCacheMirror() {
  let cachedRow = null;
  let lastSessionSig = "";
  const listeners = new Set();

  function isEmpty() {
    return cachedRow == null && lastSessionSig === "";
  }

  function notify(row) {
    for (const fn of listeners) fn(row);
  }

  function getCachedGameSession() {
    const lobbyId = getState().lobby?.id || null;
    if (!shouldExposeCachedSession(cachedRow, lobbyId)) return null;
    return cachedRow;
  }

  function onGameSessionChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function clearCachedGameSession() {
    if (isEmpty()) return;
    cachedRow = null;
    lastSessionSig = "";
    notify(null);
  }

  function invalidateCurrentLobbySessionCache() {
    clearCachedGameSession();
  }

  function __setCachedGameSessionRowForTests(row) {
    cachedRow = row;
    lastSessionSig = row ? "sig" : "";
  }

  function __resetCachedGameSessionForTests() {
    cachedRow = null;
    lastSessionSig = "";
    listeners.clear();
  }

  return {
    getCachedGameSession,
    onGameSessionChange,
    invalidateCurrentLobbySessionCache,
    __setCachedGameSessionRowForTests,
    __resetCachedGameSessionForTests,
  };
}

describe("ARCH-10 — helper canonique (miroir)", () => {
  let cache;
  let stateSnapshot;

  beforeEach(() => {
    stateSnapshot = structuredClone(getState());
    cache = createSessionCacheMirror();
    saveStatePatch({
      inLobby: true,
      lobby: { id: "lobby-1", code: "ABCD" },
      lobbyCode: "ABCD",
    });
  });

  afterEach(() => {
    saveStatePatch(stateSnapshot);
    cache.__resetCachedGameSessionForTests();
    resetVoluntaryLeaveLockForTests();
  });

  it("invalidateCurrentLobbySessionCache vide cachedRow et getCachedGameSession", () => {
    cache.__setCachedGameSessionRowForTests(SESSION_ROW);
    assert.ok(shouldExposeCachedSession(SESSION_ROW, "lobby-1"));
    assert.equal(cache.getCachedGameSession()?.game_id, "guesslie");

    cache.invalidateCurrentLobbySessionCache();
    assert.equal(cache.getCachedGameSession(), null);
  });

  it("idempotent : second clear ne notifie pas", () => {
    cache.__setCachedGameSessionRowForTests(SESSION_ROW);
    const notes = [];
    cache.onGameSessionChange((row) => notes.push(row));

    cache.invalidateCurrentLobbySessionCache();
    cache.invalidateCurrentLobbySessionCache();

    assert.deepEqual(notes, [null]);
  });
});

describe("ARCH-10 — leave volontaire", () => {
  let cache;
  let stateSnapshot;

  beforeEach(() => {
    stateSnapshot = structuredClone(getState());
    resetVoluntaryLeaveLockForTests();
    cache = createSessionCacheMirror();
    saveStatePatch({
      inLobby: true,
      lobby: { id: "lobby-1", code: "ABCD" },
      lobbyCode: "ABCD",
    });
    cache.__setCachedGameSessionRowForTests(SESSION_ROW);
  });

  afterEach(() => {
    saveStatePatch(stateSnapshot);
    cache.__resetCachedGameSessionForTests();
    resetVoluntaryLeaveLockForTests();
  });

  it("1 — cache invalidé avant sign-out (signOut en attente)", async () => {
    const signOutGate = deferred();
    const order = [];

    const p = runVoluntaryMemberLeave(
      { navigateAway: false },
      {
        getLobby: () => ({ id: "lobby-1", code: "ABCD" }),
        isGuest: () => true,
        isSupabaseConfigured: () => true,
        leaveLobbySupabase: async () => {
          order.push("delete");
          return { ok: true };
        },
        stopMultiplayerSync: () => order.push("stopMp"),
        stopLobbyPresenceSync: () => order.push("stopPres"),
        signOutAnonGuestIfNeeded: async () => {
          order.push("signOut:start");
          await signOutGate.promise;
          order.push("signOut:end");
        },
        clearGuestMembership: () => order.push("clearGuestMembership"),
        clearLocalOpenLobbySlot: () => {},
        applyLeaveLobbyLocal: () => order.push("applyLeave"),
        getUserId: () => "u-1",
        commitMembershipRemoved: () => order.push("commitRemoved"),
        beginPostLeaveHomeTransition: () => order.push("postLeave"),
        invalidateCurrentLobbySessionCache: () => {
          order.push("invalidateCache");
          cache.invalidateCurrentLobbySessionCache();
        },
      }
    );

    await Promise.resolve();
    assert.equal(cache.getCachedGameSession(), null);
    assert.ok(order.indexOf("commitRemoved") < order.indexOf("invalidateCache"));
    assert.ok(order.indexOf("invalidateCache") < order.indexOf("signOut:start"));
    assert.equal(order.includes("applyLeave"), false);

    signOutGate.resolve();
    await p;
  });

  it("2 — échec serveur : cache conservé, pas d'invalidation", async () => {
    const notes = [];
    cache.onGameSessionChange((row) => notes.push(row));

    const res = await runVoluntaryMemberLeave(
      { navigateAway: true },
      {
        getLobby: () => ({ id: "lobby-1", code: "ABCD" }),
        isGuest: () => false,
        isSupabaseConfigured: () => true,
        leaveLobbySupabase: async () => ({ ok: false, error: "timeout" }),
        stopMultiplayerSync: () => assert.fail("no stop"),
        stopLobbyPresenceSync: () => assert.fail("no stop"),
        signOutAnonGuestIfNeeded: async () => assert.fail("no signOut"),
        clearGuestMembership: () => assert.fail("no clearGuest"),
        clearLocalOpenLobbySlot: () => assert.fail("no clear"),
        applyLeaveLobbyLocal: () => assert.fail("no local leave"),
        getUserId: () => "u-1",
        commitMembershipRemoved: () => assert.fail("no commit"),
        invalidateCurrentLobbySessionCache: () => assert.fail("no invalidate"),
      }
    );

    assert.equal(res.ok, false);
    assert.equal(cache.getCachedGameSession()?.game_id, "guesslie");
    assert.deepEqual(notes, []);
  });
});

describe("ARCH-10 — kick Realtime", () => {
  let cache;
  let stateSnapshot;

  beforeEach(() => {
    stateSnapshot = structuredClone(getState());
    __resetMembershipAuthForTests();
    resetMembershipSnapshotTestState(UID_A);
    cache = createSessionCacheMirror();
    saveStatePatch({
      inLobby: true,
      lobby: { id: "lobby-1", code: "ABCD" },
      lobbyCode: "ABCD",
    });
    cache.__setCachedGameSessionRowForTests(SESSION_ROW);
  });

  afterEach(() => {
    saveStatePatch(stateSnapshot);
    cache.__resetCachedGameSessionForTests();
  });

  it("3 — kick confirmé : cache nul pendant signOut simulé (miroir pipeline)", async () => {
    const signOutGate = deferred();
    const order = [];

    commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-1" });
    order.push("commitRemoved");
    cache.invalidateCurrentLobbySessionCache();
    order.push("invalidateCache");

    const signOutP = (async () => {
      order.push("signOut:start");
      await signOutGate.promise;
      order.push("signOut:end");
    })();

    await Promise.resolve();
    assert.equal(cache.getCachedGameSession(), null);
    assert.ok(order.indexOf("commitRemoved") < order.indexOf("invalidateCache"));
    assert.ok(order.indexOf("invalidateCache") < order.indexOf("signOut:start"));
    assert.equal(order.includes("applyLeave"), false);

    signOutGate.resolve();
    await signOutP;
  });

  it("3b — contrat source kick : invalidate après commit, avant signOut", () => {
    const lobbySrc = src("js/core/lobby.js");
    const kick = lobbySrc.slice(
      lobbySrc.indexOf("export async function handleKickedFromLobby"),
      lobbySrc.indexOf("function applyHostDissolveLocalSuccess")
    );
    const commitIdx = kick.indexOf("commitMembershipRemoved");
    const invIdx = kick.indexOf("invalidateCurrentLobbySessionCache");
    const signIdx = kick.indexOf("signOutAnonGuestIfNeeded");
    assert.ok(commitIdx >= 0 && invIdx > commitIdx && signIdx > invIdx);
  });
});

describe("ARCH-10 — dissolution hôte", () => {
  it("4a — contrat source : invalidate après closeLobby OK, avant signOut", () => {
    const lobbySrc = src("js/core/lobby.js");
    const block = lobbySrc.slice(
      lobbySrc.indexOf("export async function dissolveLobbyAsHost"),
      lobbySrc.indexOf("export async function confirmAndLeaveLobby")
    );
    const closeIdx = block.indexOf("closeLobbySupabase");
    const invalidateIdx = block.indexOf("invalidateCurrentLobbySessionCache");
    const signOutIdx = block.indexOf("signOutAnonGuestIfNeeded");
    const applyIdx = block.indexOf("applyHostDissolveLocalSuccess");
    assert.ok(closeIdx >= 0);
    assert.ok(invalidateIdx > closeIdx);
    assert.ok(signOutIdx > invalidateIdx);
    assert.ok(applyIdx > signOutIdx);
    assert.match(block, /commitMembershipRemoved/);
  });

  it("4b — échec dissolution : pas d'invalidate précoce dans branche !res.ok", () => {
    const lobbySrc = src("js/core/lobby.js");
    const dissolve = lobbySrc.slice(
      lobbySrc.indexOf("export async function dissolveLobbyAsHost"),
      lobbySrc.indexOf("export async function confirmAndLeaveLobby")
    );
    const failStart = dissolve.indexOf("if (!res.ok)");
    const failEnd = dissolve.indexOf(
      "if (res.status === LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE"
    );
    const failBranch = dissolve.slice(failStart, failEnd);
    assert.equal(
      failBranch.includes("invalidateCurrentLobbySessionCache"),
      false
    );
  });
});

describe("ARCH-10 — teardown canonique", () => {
  let cache;

  beforeEach(() => {
    cache = createSessionCacheMirror();
  });

  afterEach(() => {
    cache.__resetCachedGameSessionForTests();
  });

  it("5 — performLobbyBoundaryTeardown utilise invalidate (source)", () => {
    const lobbySrc = src("js/core/lobby.js");
    const block = lobbySrc.slice(
      lobbySrc.indexOf("export function performLobbyBoundaryTeardown"),
      lobbySrc.indexOf("const EVENING_ROLLBACK_KEYS")
    );
    assert.match(block, /invalidateCurrentLobbySessionCache\(\)/);
    assert.match(block, /bumpLobbyRuntimeGeneration/);
    assert.match(block, /stopMultiplayerSync/);
    assert.match(block, /stopLobbyPresenceSync/);
    assert.match(block, /resetEveningState/);
  });

  it("5b — early invalidate + teardown simulate reste idempotent côté notif", () => {
    cache.__setCachedGameSessionRowForTests(SESSION_ROW);
    saveStatePatch({
      inLobby: true,
      lobby: { id: "lobby-1", code: "ABCD" },
      lobbyCode: "ABCD",
    });
    const notes = [];
    cache.onGameSessionChange((row) => notes.push(row));

    cache.invalidateCurrentLobbySessionCache();
    cache.invalidateCurrentLobbySessionCache();

    assert.equal(cache.getCachedGameSession(), null);
    assert.deepEqual(notes, [null]);
  });
});

describe("ARCH-10 — notification consommateur", () => {
  let cache;

  beforeEach(() => {
    cache = createSessionCacheMirror();
  });

  afterEach(() => {
    cache.__resetCachedGameSessionForTests();
  });

  it("6 — listener reçoit null dès invalidation précoce ; une seule notif utile", () => {
    cache.__setCachedGameSessionRowForTests(SESSION_ROW);
    saveStatePatch({
      inLobby: true,
      lobby: { id: "lobby-1", code: "ABCD" },
      lobbyCode: "ABCD",
    });

    const notes = [];
    cache.onGameSessionChange((row) => notes.push(row));

    cache.invalidateCurrentLobbySessionCache();
    assert.deepEqual(notes, [null]);
    assert.equal(cache.getCachedGameSession(), null);

    cache.invalidateCurrentLobbySessionCache();
    assert.deepEqual(notes, [null]);
  });
});

describe("ARCH-10 — frontière lobby A → B", () => {
  let cache;
  let stateSnapshot;

  beforeEach(() => {
    stateSnapshot = structuredClone(getState());
    cache = createSessionCacheMirror();
  });

  afterEach(() => {
    saveStatePatch(stateSnapshot);
    cache.__resetCachedGameSessionForTests();
  });

  it("7 — session A invalidée ; B acceptée ensuite", () => {
    saveStatePatch({
      inLobby: true,
      lobby: { id: "lobby-a", code: "AAAA" },
      lobbyCode: "AAAA",
    });
    cache.__setCachedGameSessionRowForTests({
      ...SESSION_ROW,
      lobby_id: "lobby-a",
    });
    assert.equal(cache.getCachedGameSession()?.lobby_id, "lobby-a");

    cache.invalidateCurrentLobbySessionCache();
    assert.equal(cache.getCachedGameSession(), null);

    saveStatePatch({
      inLobby: true,
      lobby: { id: "lobby-b", code: "BBBB" },
      lobbyCode: "BBBB",
    });
    const rowB = {
      ...SESSION_ROW,
      lobby_id: "lobby-b",
      game_id: "hottake",
      screen: "hottake-prep",
    };
    cache.__setCachedGameSessionRowForTests(rowB);
    assert.equal(cache.getCachedGameSession()?.lobby_id, "lobby-b");
    assert.equal(shouldExposeCachedSession(rowB, "lobby-b"), true);
  });
});

describe("ARCH-10 — contrat source pipelines", () => {
  it("8 — helper canonique, wiring leave/kick/dissolve/teardown/XX-E", () => {
    const voluntary = src("js/core/voluntaryMemberLeave.js");
    assert.match(voluntary, /invalidateCurrentLobbySessionCache\?\.\(\)/);
    assert.equal((voluntary.match(/clearCachedGameSession/g) || []).length, 0);

    const lobbySrc = src("js/core/lobby.js");
    const kick = lobbySrc.slice(
      lobbySrc.indexOf("export async function handleKickedFromLobby"),
      lobbySrc.indexOf("function applyHostDissolveLocalSuccess")
    );
    assert.match(kick, /commitMembershipRemoved/);
    assert.match(kick, /invalidateCurrentLobbySessionCache/);

    const dissolveGuest = lobbySrc.slice(
      lobbySrc.indexOf("export async function resolveLobbyClosureAndExit"),
      lobbySrc.indexOf("export async function handleLobbyDissolvedForGuest")
    );
    assert.match(dissolveGuest, /invalidateCurrentLobbySessionCache/);
    assert.match(dissolveGuest, /getLobbyClosureCopy/);

    const leaveFn = lobbySrc.slice(
      lobbySrc.indexOf("export async function leaveLobby("),
      lobbySrc.indexOf("export async function leaveLobbyMembershipFromServer")
    );
    assert.match(leaveFn, /invalidateCurrentLobbySessionCache/);

    const teardown = lobbySrc.slice(
      lobbySrc.indexOf("export function performLobbyBoundaryTeardown"),
      lobbySrc.indexOf("const EVENING_ROLLBACK_KEYS")
    );
    assert.match(teardown, /invalidateCurrentLobbySessionCache\(\)/);

    const gameSyncSrc = src("js/core/gameSync.js");
    assert.match(
      gameSyncSrc,
      /export function invalidateCurrentLobbySessionCache/
    );
    assert.match(
      gameSyncSrc,
      /ARCH-10 — invalidation précoce du cache session MP/
    );
  });
});
