/**
 * SYN-VOTE-ROLLBACK-01 - cycles comportementaux (SpeedVote mock + algorithme partagé).
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "../js/core/optimisticMapEntry.js";

/**
 * Miroir du contrat commit* (apply → patch → rollback conditionnel).
 * Couvre Dilemma / Traitre / TierNight / WAO sans importer leurs graphes.
 */
function simulateOptimisticCommitCycle({
  session,
  mapKey,
  playerKey,
  value,
  patchFails,
  mutateBeforeCatch,
  attemptId = 1,
  currentAttemptId = 1,
}) {
  const apply = computeOptimisticMapEntryApply({
    map: session[mapKey],
    key: playerKey,
    value,
  });
  let live = { ...session, [mapKey]: apply.nextMap };
  const captured = {
    runId: session.runId,
    phase: session.phase,
    roundIdx: session.roundIdx,
  };
  if (typeof mutateBeforeCatch === "function") {
    live = mutateBeforeCatch(live);
  }
  if (!patchFails) {
    return { live, rolled: false, applied: false };
  }
  let applied = false;
  if (
    attemptId === currentAttemptId &&
    canRollbackOptimisticSubmission(captured, live)
  ) {
    const rolled = rollbackOptimisticMapEntry({
      currentMap: live[mapKey],
      key: playerKey,
      hadPreviousValue: apply.hadPreviousValue,
      previousValue: apply.previousValue,
      optimisticValue: apply.optimisticValue,
      attemptId,
      currentAttemptId,
    });
    if (rolled.applied) {
      live = { ...live, [mapKey]: rolled.map };
      applied = true;
    }
  }
  return { live, rolled: true, applied };
}

describe("SYN-VOTE-ROLLBACK-01 - cycles simulés (tous jeux)", () => {
  const cases = [
    { name: "SpeedVote", mapKey: "votes", phase: "voting", value: "Bob" },
    { name: "Dilemma", mapKey: "votes", phase: "voting", value: "A" },
    { name: "WAO vote", mapKey: "votes", phase: "voting", value: "Bob" },
    { name: "Traitre", mapKey: "votes", phase: "vote", value: "Bob" },
    {
      name: "TierNight Live",
      mapKey: "votes",
      phase: "voting",
      value: "S",
      runId: "run-1",
    },
    {
      name: "WAO answer",
      mapKey: "answers",
      phase: "answer",
      value: { text: "girafe", at: 1 },
    },
  ];

  for (const c of cases) {
    it(`${c.name} : succès - pas de rollback`, () => {
      const session = {
        phase: c.phase,
        roundIdx: 0,
        runId: c.runId ?? null,
        [c.mapKey]: { Bob: c.mapKey === "answers" ? { text: "x", at: 0 } : "keep" },
      };
      const out = simulateOptimisticCommitCycle({
        session,
        mapKey: c.mapKey,
        playerKey: "Alice",
        value: c.value,
        patchFails: false,
      });
      assert.equal(out.rolled, false);
      assert.deepEqual(out.live[c.mapKey].Alice, c.value);
      assert.ok(out.live[c.mapKey].Bob != null);
    });

    it(`${c.name} : échec - retire / restaure uniquement Alice`, () => {
      const session = {
        phase: c.phase,
        roundIdx: 0,
        runId: c.runId ?? null,
        [c.mapKey]: { Bob: c.mapKey === "answers" ? { text: "x", at: 0 } : "keep" },
      };
      const out = simulateOptimisticCommitCycle({
        session,
        mapKey: c.mapKey,
        playerKey: "Alice",
        value: c.value,
        patchFails: true,
      });
      assert.equal(out.applied, true);
      assert.equal(Object.prototype.hasOwnProperty.call(out.live[c.mapKey], "Alice"), false);
      assert.ok(out.live[c.mapKey].Bob != null);
    });

    it(`${c.name} : autre joueur ajouté avant catch - préservé`, () => {
      const session = {
        phase: c.phase,
        roundIdx: 0,
        runId: c.runId ?? null,
        [c.mapKey]: {},
      };
      const otherVal =
        c.mapKey === "answers" ? { text: "npc", at: 2 } : "Charlie";
      const out = simulateOptimisticCommitCycle({
        session,
        mapKey: c.mapKey,
        playerKey: "Alice",
        value: c.value,
        patchFails: true,
        mutateBeforeCatch: (live) => ({
          ...live,
          [c.mapKey]: { ...live[c.mapKey], Charlie: otherVal },
        }),
      });
      assert.equal(out.applied, true);
      assert.deepEqual(out.live[c.mapKey].Charlie, otherVal);
      assert.equal(Object.prototype.hasOwnProperty.call(out.live[c.mapKey], "Alice"), false);
    });

    it(`${c.name} : valeur remplacée avant catch - no-op`, () => {
      const session = {
        phase: c.phase,
        roundIdx: 0,
        runId: c.runId ?? null,
        [c.mapKey]: {},
      };
      const newer =
        c.mapKey === "answers" ? { text: "retry", at: 9 } : "newer";
      const out = simulateOptimisticCommitCycle({
        session,
        mapKey: c.mapKey,
        playerKey: "Alice",
        value: c.value,
        patchFails: true,
        mutateBeforeCatch: (live) => ({
          ...live,
          [c.mapKey]: { ...live[c.mapKey], Alice: newer },
        }),
      });
      assert.equal(out.applied, false);
      assert.deepEqual(out.live[c.mapKey].Alice, newer);
    });

    it(`${c.name} : runId / phase change - no-op`, () => {
      const session = {
        phase: c.phase,
        roundIdx: 0,
        runId: c.runId ?? "run-1",
        [c.mapKey]: {},
      };
      const out = simulateOptimisticCommitCycle({
        session,
        mapKey: c.mapKey,
        playerKey: "Alice",
        value: c.value,
        patchFails: true,
        mutateBeforeCatch: (live) => ({
          ...live,
          runId: "run-2",
          phase: "reveal",
        }),
      });
      assert.equal(out.applied, false);
      assert.deepEqual(out.live[c.mapKey].Alice, c.value);
    });

    it(`${c.name} : ancienne tentative (stale attemptId) - no-op`, () => {
      const session = {
        phase: c.phase,
        roundIdx: 0,
        runId: c.runId ?? null,
        [c.mapKey]: {},
      };
      const out = simulateOptimisticCommitCycle({
        session,
        mapKey: c.mapKey,
        playerKey: "Alice",
        value: c.value,
        patchFails: true,
        attemptId: 1,
        currentAttemptId: 2,
      });
      assert.equal(out.applied, false);
      assert.deepEqual(out.live[c.mapKey].Alice, c.value);
    });
  }
});

describe("commitSpeedVoteVote - mocks comportementaux", () => {
  const UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
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
    speedVoteGame: savedSession,
  }));
  const saveStatePatchMock = mock.fn((patch) => {
    saveCalls.push(patch);
    if (patch.speedVoteGame) savedSession = patch.speedVoteGame;
  });

  let commitSpeedVoteVote;
  let __resetSpeedVoteVoteAttemptIdForTests;

  beforeEach(async () => {
    savedSession = {
      phase: "voting",
      roundIdx: 0,
      votes: { Bob: "Carol" },
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
        syncSpeedVoteSession: mock.fn(),
        allMembersReady: mock.fn(),
        speedVoteToRemote: mock.fn((s) => s),
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
        getActivePlayerNames: mock.fn(() => ["Alice", "Bob", "Carol"]),
      },
    });
    mock.module("../data/speedVote.js", {
      namedExports: {
        SPEED_VOTE_THEMES: [],
        SPEED_VOTE_CATALOG_ID: "default",
        SPEED_VOTE_ROUND_PRESETS: [5],
        SPEED_VOTE_TIMER_SEC: 30,
        SPEED_VOTE_MODIFIERS: {},
        getSpeedVoteThemeQuestions: mock.fn(() => []),
      },
    });
    mock.module("../js/core/speedVoteDuration.js", {
      namedExports: {
        SPEED_VOTE_ROUND_ALL: "all",
        estimateSpeedVoteDuration: mock.fn(() => 0),
        resolveEffectiveRoundCount: mock.fn(() => 5),
      },
    });

    const mod = await import("../js/core/speedVoteSession.js");
    commitSpeedVoteVote = mod.commitSpeedVoteVote;
    __resetSpeedVoteVoteAttemptIdForTests = mod.__resetSpeedVoteVoteAttemptIdForTests;
    __resetSpeedVoteVoteAttemptIdForTests();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("succès : vote optimiste + patch wire + pas de rollback", async () => {
    const result = await commitSpeedVoteVote("Bob");
    assert.equal(result, "Bob");
    assert.equal(savedSession.votes.Alice, "Bob");
    assert.equal(savedSession.votes.Bob, "Carol");
    assert.equal(patchMock.mock.callCount(), 1);
    const wire = patchMock.mock.calls[0].arguments[0];
    assert.deepEqual(wire, { speedVote: { votes: { [UID]: "Bob" } } });
    assert.ok(saveCalls.length >= 1);
  });

  it("échec : rollback Alice uniquement + rethrow", async () => {
    patchShouldFail = true;
    await assert.rejects(() => commitSpeedVoteVote("Bob"), /sync failed/);
    assert.equal(Object.prototype.hasOwnProperty.call(savedSession.votes, "Alice"), false);
    assert.equal(savedSession.votes.Bob, "Carol");
  });

  it("échec après Realtime Bob→autre : préserve Bob", async () => {
    patchShouldFail = true;
    patchMock.mock.mockImplementation(async () => {
      savedSession = {
        ...savedSession,
        votes: { ...savedSession.votes, Bob: "Alice", Dave: "Carol" },
      };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitSpeedVoteVote("Bob"));
    assert.equal(Object.prototype.hasOwnProperty.call(savedSession.votes, "Alice"), false);
    assert.equal(savedSession.votes.Bob, "Alice");
    assert.equal(savedSession.votes.Dave, "Carol");
  });

  it("échec après remplacement local Alice : no-op", async () => {
    patchShouldFail = true;
    patchMock.mock.mockImplementation(async () => {
      savedSession = {
        ...savedSession,
        votes: { ...savedSession.votes, Alice: "Carol" },
      };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitSpeedVoteVote("Bob"));
    assert.equal(savedSession.votes.Alice, "Carol");
  });

  it("phase change avant catch : no-op", async () => {
    patchShouldFail = true;
    patchMock.mock.mockImplementation(async () => {
      savedSession = { ...savedSession, phase: "reveal" };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitSpeedVoteVote("Bob"));
    assert.equal(savedSession.votes.Alice, "Bob");
  });

  it("stale catch après retry : ne rollback pas la 2e tentative", async () => {
    let resolveFirst;
    const firstGate = new Promise((r) => {
      resolveFirst = r;
    });
    let call = 0;
    patchMock.mock.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        await firstGate;
        throw new Error("first failed");
      }
      return undefined;
    });

    const p1 = commitSpeedVoteVote("Bob");
    // Retire le vote optimiste du 1er pour autoriser un retry concurrent.
    delete savedSession.votes.Alice;
    const p2 = commitSpeedVoteVote("Carol");
    resolveFirst();
    await assert.rejects(() => p1, /first failed/);
    await p2;
    assert.equal(savedSession.votes.Alice, "Carol");
  });
});
