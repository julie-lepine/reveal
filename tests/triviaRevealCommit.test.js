import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

const RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LOBBY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const rpcRevealMock = mock.fn();
const refreshMock = mock.fn();
const applyRemoteMock = mock.fn();
const isGameSyncActiveMock = mock.fn(() => true);

let savedTriviaSession = {
  phase: "question",
  runId: RUN_ID,
  questionIdx: 0,
  matchScores: {},
};

const getStateMock = mock.fn(() => ({
  lobby: { id: LOBBY_ID },
  triviaGame: savedTriviaSession,
}));

mock.module("../js/core/gameSessionRpc.js", {
  namedExports: {
    rpcRevealTriviaRound: rpcRevealMock,
  },
});

mock.module("../js/core/gameSync.js", {
  namedExports: {
    isGameSyncActive: isGameSyncActiveMock,
    applyRemoteSession: applyRemoteMock,
    refreshGameSession: refreshMock,
    triviaToRemote: mock.fn(),
    syncTriviaSession: mock.fn(),
    requireLocalParticipantUid: mock.fn(),
    isLobbyHost: mock.fn(),
    allMembersReady: mock.fn(),
    playerKeyToDisplayName: mock.fn(),
  },
});

mock.module("../js/core/state.js", {
  namedExports: {
    getState: getStateMock,
    getLocalDisplayName: mock.fn(() => "Host"),
    saveStatePatch: mock.fn((patch) => {
      if (patch.triviaGame) savedTriviaSession = patch.triviaGame;
    }),
    addScore: mock.fn(),
    setActiveScoringGame: mock.fn(),
  },
});

mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    commitHostGamePlay: mock.fn(),
    commitPrepReadyToggle: mock.fn(),
    launchGameWithSync: mock.fn(),
  },
});

mock.module("../js/core/patchGameStateFeedback.js", {
  namedExports: { patchGameStateWithFeedback: mock.fn() },
});

mock.module("../js/core/players.js", {
  namedExports: {
    getActivePlayerNames: mock.fn(() => ["Host"]),
    getActivePlayers: mock.fn(() => [{ name: "Host" }]),
  },
});

mock.module("../js/core/lobby.js", {
  namedExports: { getLobbyParticipants: mock.fn(() => []) },
});

const { commitTriviaRevealPlay } = await import("../js/core/triviaSession.js");

describe("commitTriviaRevealPlay — recovery timeout", () => {
  beforeEach(() => {
    savedTriviaSession = {
      phase: "question",
      runId: RUN_ID,
      questionIdx: 0,
      matchScores: {},
    };
    rpcRevealMock.mock.resetCalls();
    refreshMock.mock.resetCalls();
    applyRemoteMock.mock.resetCalls();
    isGameSyncActiveMock.mock.mockImplementation(() => true);
  });

  afterEach(() => {
    mock.reset();
  });

  it("RPC timeout + refresh reveal → succès sans second RPC", async () => {
    rpcRevealMock.mock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    refreshMock.mock.mockImplementation(async () => ({
      lobby_id: LOBBY_ID,
      state: {
        trivia: {
          runId: RUN_ID,
          questionIdx: 0,
          phase: "reveal",
          questionScored: true,
          matchScores: { Host: 10 },
        },
      },
    }));

    await commitTriviaRevealPlay();
    assert.equal(rpcRevealMock.mock.callCount(), 1);
    assert.equal(refreshMock.mock.callCount(), 1);
    assert.equal(applyRemoteMock.mock.callCount(), 1);
  });

  it("RPC timeout + refresh question → erreur conservée", async () => {
    rpcRevealMock.mock.mockImplementation(async () => {
      throw new Error("network timeout");
    });
    refreshMock.mock.mockImplementation(async () => ({
      lobby_id: LOBBY_ID,
      state: {
        trivia: {
          runId: RUN_ID,
          questionIdx: 0,
          phase: "question",
          questionScored: false,
        },
      },
    }));

    await assert.rejects(() => commitTriviaRevealPlay(), /timeout/i);
    assert.equal(refreshMock.mock.callCount(), 1);
  });

  it("erreur métier TRIVIA_STALE_RUN → pas de refresh", async () => {
    rpcRevealMock.mock.mockImplementation(async () => {
      const err = new Error("TRIVIA_STALE_RUN");
      throw err;
    });

    await assert.rejects(
      () => commitTriviaRevealPlay(),
      /autre partie/i
    );
    assert.equal(refreshMock.mock.callCount(), 0);
  });
});
