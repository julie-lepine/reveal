/**
 * AUDIT-003 — rollback concurrent HotTake / Clutch (entrée locale seule).
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

const UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("AUDIT-003 commitHotTakeVote", () => {
  let savedSession;
  let saveCalls;
  let patchShouldFail;
  const patchMock = mock.fn(async () => {
    if (patchShouldFail) throw new Error("sync failed");
  });
  const getLocalDisplayNameMock = mock.fn(() => "Alice");
  const isGameSyncActiveMock = mock.fn(() => true);
  const getStateMock = mock.fn(() => ({
    lobby: { id: "lobby-1" },
    hotTakeGame: savedSession,
  }));
  const saveStatePatchMock = mock.fn((patch) => {
    saveCalls.push(patch);
    if (patch.hotTakeGame) savedSession = patch.hotTakeGame;
  });

  let commitHotTakeVote;
  let __resetHotTakeVoteAttemptIdForTests;

  beforeEach(async () => {
    savedSession = {
      phase: "question",
      takeIdx: 0,
      votes: { Bob: "A" },
      lobbyStarted: true,
    };
    saveCalls = [];
    patchShouldFail = false;
    patchMock.mock.resetCalls();
    saveStatePatchMock.mock.resetCalls();
    isGameSyncActiveMock.mock.mockImplementation(() => true);

    mock.module("../js/core/patchGameStateFeedback.js", {
      namedExports: { patchGameStateWithFeedback: patchMock },
    });
    mock.module("../js/core/gameSync.js", {
      namedExports: {
        isGameSyncActive: isGameSyncActiveMock,
        requireLocalParticipantUid: mock.fn(() => UID),
        isLobbyHost: mock.fn(() => false),
        syncHotTakeSession: mock.fn(),
        allMembersReady: mock.fn(),
        hotTakeToRemote: mock.fn((s) => s),
        patchGameState: mock.fn(),
        normalizePlayerVotesMap: (votes) => votes || {},
      },
    });
    mock.module("../js/core/lobby.js", {
      namedExports: {
        getLobbyParticipants: mock.fn(() => [
          { userId: UID, name: "Alice" },
          { userId: "uid-bob", name: "Bob" },
        ]),
        setLobbyPlaying: mock.fn(),
      },
    });
    mock.module("../js/core/state.js", {
      namedExports: {
        getState: getStateMock,
        getLocalDisplayName: getLocalDisplayNameMock,
        saveStatePatch: saveStatePatchMock,
      },
    });
    mock.module("../js/core/mpLaunch.js", {
      namedExports: {
        commitHostGamePlay: mock.fn(),
        commitPrepReadyToggle: mock.fn(),
        launchGameWithSync: mock.fn(),
      },
    });
    mock.module("../js/core/players.js", {
      namedExports: {
        getActivePlayerNames: mock.fn(() => ["Alice", "Bob"]),
        getActivePlayers: mock.fn(() => []),
      },
    });
    mock.module("../js/core/sessionMerge.js", {
      namedExports: { mergeHotTakeCustomTakes: mock.fn((a) => a) },
    });
    mock.module("../js/core/combinedGameDeck.js", {
      namedExports: { countOtherAuthorsCustomEntries: mock.fn(() => 0) },
    });
    mock.module("../js/core/hotTakeDuration.js", {
      namedExports: {
        HOT_TAKE_ROUND_ALL: "all",
        estimateHotTakeDuration: mock.fn(() => 0),
        resolveEffectiveRoundCount: mock.fn(() => 5),
      },
    });
    mock.module("../js/core/hotTakeModeration.js", {
      namedExports: {
        checkHotTakeModeration: mock.fn(() => ({ blocked: false })),
        getHotTakeModerationNotice: mock.fn(() => null),
      },
    });

    const mod = await import("../js/core/hotTakeSession.js");
    commitHotTakeVote = mod.commitHotTakeVote;
    __resetHotTakeVoteAttemptIdForTests = mod.__resetHotTakeVoteAttemptIdForTests;
    __resetHotTakeVoteAttemptIdForTests();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("succès : vote A reste", async () => {
    await commitHotTakeVote("B");
    assert.equal(savedSession.votes.Alice, "B");
    assert.equal(savedSession.votes.Bob, "A");
  });

  it("échec sans concurrence : retire A, conserve Bob déjà présent", async () => {
    patchShouldFail = true;
    await assert.rejects(() => commitHotTakeVote("B"), /sync failed/);
    assert.equal(Object.prototype.hasOwnProperty.call(savedSession.votes, "Alice"), false);
    assert.equal(savedSession.votes.Bob, "A");
  });

  it("échec concurrent : B injecté pendant await survit ; A retiré", async () => {
    savedSession = {
      phase: "question",
      takeIdx: 0,
      votes: {},
      lobbyStarted: true,
    };
    patchMock.mock.mockImplementation(async () => {
      savedSession = {
        ...savedSession,
        votes: { ...savedSession.votes, Bob: "C" },
      };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitHotTakeVote("B"));
    assert.equal(Object.prototype.hasOwnProperty.call(savedSession.votes, "Alice"), false);
    assert.equal(savedSession.votes.Bob, "C");
  });

  it("phase incompatible pendant await : no-op (A reste)", async () => {
    patchMock.mock.mockImplementation(async () => {
      savedSession = { ...savedSession, phase: "reveal" };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitHotTakeVote("B"));
    assert.equal(savedSession.votes.Alice, "B");
    assert.equal(savedSession.votes.Bob, "A");
  });

  it("takeIdx avancé pendant await : no-op", async () => {
    patchMock.mock.mockImplementation(async () => {
      savedSession = { ...savedSession, takeIdx: 1 };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitHotTakeVote("B"));
    assert.equal(savedSession.votes.Alice, "B");
  });

  it("catch ne restaure pas une map complète (pas previousVotes)", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../js/core/hotTakeSession.js", import.meta.url), "utf8")
    );
    const start = src.indexOf("export async function commitHotTakeVote");
    const block = src.slice(start, src.indexOf("export function __resetHotTakeVoteAttemptIdForTests"));
    assert.match(block, /rollbackOptimisticMapEntry/);
    assert.equal(block.includes("votes: previousVotes"), false);
    assert.equal(block.includes("previousVotes"), false);
  });
});

describe("AUDIT-003 commitClutchTap", () => {
  let savedSession;
  let patchShouldFail;
  const patchMock = mock.fn(async () => {
    if (patchShouldFail) throw new Error("sync failed");
  });
  const getLocalDisplayNameMock = mock.fn(() => "Alice");
  const isGameSyncActiveMock = mock.fn(() => true);
  const getStateMock = mock.fn(() => ({
    lobby: { id: "lobby-1" },
    clutchGame: savedSession,
  }));
  const saveStatePatchMock = mock.fn((patch) => {
    if (patch.clutchGame) savedSession = patch.clutchGame;
  });

  let commitClutchTap;
  let __resetClutchTapAttemptIdForTests;

  beforeEach(async () => {
    savedSession = {
      phase: "active",
      roundIdx: 0,
      taps: { Bob: { ms: 900, at: 1 } },
      lobbyStarted: true,
    };
    patchShouldFail = false;
    patchMock.mock.resetCalls();
    saveStatePatchMock.mock.resetCalls();
    isGameSyncActiveMock.mock.mockImplementation(() => true);

    mock.module("../js/core/gameSync.js", {
      namedExports: {
        isGameSyncActive: isGameSyncActiveMock,
        requireLocalParticipantUid: mock.fn(() => UID),
        syncClutchSession: mock.fn(),
        allMembersReady: mock.fn(),
        clutchToRemote: mock.fn((s) => s),
        patchGameState: patchMock,
      },
    });
    mock.module("../js/core/lobby.js", {
      namedExports: {
        getLobbyParticipants: mock.fn(() => [
          { userId: UID, name: "Alice" },
          { userId: "uid-bob", name: "Bob" },
        ]),
        setLobbyPlaying: mock.fn(),
      },
    });
    mock.module("../js/core/state.js", {
      namedExports: {
        getState: getStateMock,
        getLocalDisplayName: getLocalDisplayNameMock,
        saveStatePatch: saveStatePatchMock,
      },
    });
    mock.module("../js/core/mpLaunch.js", {
      namedExports: {
        commitHostGamePlay: mock.fn(),
        commitPrepReadyToggle: mock.fn(),
        launchGameWithSync: mock.fn(),
      },
    });
    mock.module("../js/core/players.js", {
      namedExports: {
        getActivePlayerNames: mock.fn(() => ["Alice", "Bob"]),
      },
    });
    mock.module("../js/core/authErrors.js", {
      namedExports: {
        formatSyncErrorMessage: (m) => String(m || "err"),
      },
    });
    mock.module("../js/core/dialog.js", {
      namedExports: {
        showAppAlert: mock.fn(async () => {}),
      },
    });

    const mod = await import("../js/core/clutchSession.js");
    commitClutchTap = mod.commitClutchTap;
    __resetClutchTapAttemptIdForTests = mod.__resetClutchTapAttemptIdForTests;
    __resetClutchTapAttemptIdForTests();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("succès : tap A reste", async () => {
    const tap = { ms: 1100, at: 2 };
    await commitClutchTap(tap);
    assert.equal(savedSession.taps.Alice.ms, 1100);
    assert.equal(savedSession.taps.Bob.ms, 900);
  });

  it("échec sans concurrence : retire A, conserve Bob", async () => {
    patchShouldFail = true;
    await assert.rejects(() => commitClutchTap({ ms: 1100, at: 2 }), /sync failed/);
    assert.equal(Object.prototype.hasOwnProperty.call(savedSession.taps, "Alice"), false);
    assert.equal(savedSession.taps.Bob.ms, 900);
  });

  it("échec concurrent : B injecté pendant await survit ; A retiré", async () => {
    savedSession = {
      phase: "active",
      roundIdx: 0,
      taps: {},
      lobbyStarted: true,
    };
    patchMock.mock.mockImplementation(async () => {
      savedSession = {
        ...savedSession,
        taps: {
          ...savedSession.taps,
          Bob: { ms: 800, at: 9 },
        },
      };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitClutchTap({ ms: 1100, at: 2 }));
    assert.equal(Object.prototype.hasOwnProperty.call(savedSession.taps, "Alice"), false);
    assert.equal(savedSession.taps.Bob.ms, 800);
  });

  it("phase incompatible pendant await : no-op", async () => {
    patchMock.mock.mockImplementation(async () => {
      savedSession = { ...savedSession, phase: "reveal" };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitClutchTap({ ms: 1100, at: 2 }));
    assert.equal(savedSession.taps.Alice.ms, 1100);
    assert.equal(savedSession.taps.Bob.ms, 900);
  });

  it("catch ne restaure pas previousTaps entier", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../js/core/clutchSession.js", import.meta.url), "utf8");
    const start = src.indexOf("export async function commitClutchTap");
    const block = src.slice(start, src.indexOf("export function __resetClutchTapAttemptIdForTests"));
    assert.match(block, /rollbackOptimisticMapEntry/);
    assert.equal(block.includes("taps: previousTaps"), false);
    assert.equal(block.includes("previousTaps"), false);
  });
});
