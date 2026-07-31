import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

const RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LOBBY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HOST_UID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const GUEST_UID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const rpcSubmitMock = mock.fn();
const rpcRevealMock = mock.fn();
const patchMock = mock.fn();
const refreshMock = mock.fn();
const applyRemoteMock = mock.fn();
const isGameSyncActiveMock = mock.fn(() => true);
const saveStatePatchMock = mock.fn();

let savedTriviaSession = {
  phase: "question",
  runId: RUN_ID,
  questionIdx: 0,
  matchScores: {},
  answers: {},
};

const getLocalDisplayNameMock = mock.fn(() => "Host");
const requireLocalUidMock = mock.fn(() => HOST_UID);
let actingUid = HOST_UID;
let actingName = "Host";

function commitHostAnswer() {
  actingUid = HOST_UID;
  actingName = "Host";
  getLocalDisplayNameMock.mock.mockImplementation(() => actingName);
  requireLocalUidMock.mock.mockImplementation(() => actingUid);
  return commitTriviaAnswer(1);
}

function commitGuestAnswer() {
  actingUid = GUEST_UID;
  actingName = "Guest";
  getLocalDisplayNameMock.mock.mockImplementation(() => actingName);
  requireLocalUidMock.mock.mockImplementation(() => actingUid);
  return commitTriviaAnswer(0);
}

const getStateMock = mock.fn(() => ({
  lobby: { id: LOBBY_ID },
  triviaGame: savedTriviaSession,
}));

mock.module("../js/core/gameSessionRpc.js", {
  namedExports: {
    rpcSubmitTriviaAnswer: rpcSubmitMock,
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
    requireLocalParticipantUid: requireLocalUidMock,
    isLobbyHost: mock.fn(() => true),
    allMembersReady: mock.fn(),
    playerKeyToDisplayName: mock.fn((key) => (key === HOST_UID ? "Host" : key)),
  },
});

mock.module("../js/core/state.js", {
  namedExports: {
    getState: getStateMock,
    getLocalDisplayName: getLocalDisplayNameMock,
    saveStatePatch: saveStatePatchMock,
    addScore: mock.fn(),
    setActiveScoringGame: mock.fn(),
  },
});

mock.module("../js/core/patchGameStateFeedback.js", {
  namedExports: { patchGameStateWithFeedback: patchMock },
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
    getActivePlayerNames: mock.fn(() => ["Host", "Guest"]),
    getActivePlayers: mock.fn(() => [
      { name: "Host" },
      { name: "Guest" },
    ]),
  },
});

mock.module("../js/core/lobby.js", {
  namedExports: {
    getLobbyParticipants: mock.fn(() => [
      { userId: HOST_UID, name: "Host" },
      { userId: GUEST_UID, name: "Guest" },
    ]),
  },
});

const { commitTriviaAnswer } = await import("../js/core/triviaSession.js");

function revealRowFromAnswers(answers) {
  return {
    lobby_id: LOBBY_ID,
    state: {
      trivia: {
        runId: RUN_ID,
        questionIdx: 0,
        phase: "reveal",
        questionScored: true,
        answers,
        matchScores: { Host: 10, Guest: 10 },
        lastRound: {
          correctIndex: 1,
          correctPlayers: [HOST_UID, GUEST_UID],
          fastestPlayer: HOST_UID,
          deltas: { Host: 10, Guest: 10 },
        },
      },
    },
  };
}

describe("commitTriviaAnswer — 01B-bis RPC", () => {
  beforeEach(() => {
    savedTriviaSession = {
      phase: "question",
      runId: RUN_ID,
      questionIdx: 0,
      matchScores: {},
      answers: {},
    };
    rpcSubmitMock.mock.resetCalls();
    rpcRevealMock.mock.resetCalls();
    patchMock.mock.resetCalls();
    refreshMock.mock.resetCalls();
    applyRemoteMock.mock.resetCalls();
    saveStatePatchMock.mock.resetCalls();
    isGameSyncActiveMock.mock.mockImplementation(() => true);
  });

  afterEach(() => {
    mock.reset();
  });

  it("MP concurrent : host + guest passent par rpcSubmitTriviaAnswer", async () => {
    const answers = {};
    rpcSubmitMock.mock.mockImplementation(async ({ answerIndex }) => {
      const uid = answerIndex === 1 ? HOST_UID : GUEST_UID;
      answers[uid] = { answerIndex, answeredAt: 100 };
      if (Object.keys(answers).length < 2) {
        return {
          lobby_id: LOBBY_ID,
          state: {
            trivia: {
              runId: RUN_ID,
              questionIdx: 0,
              phase: "question",
              questionScored: false,
              answers: { ...answers },
            },
          },
        };
      }
      return revealRowFromAnswers({ ...answers });
    });

    applyRemoteMock.mock.mockImplementation((row) => {
      if (row?.state?.trivia) savedTriviaSession = row.state.trivia;
    });

    await Promise.all([commitHostAnswer(), commitGuestAnswer()]);

    assert.equal(rpcSubmitMock.mock.callCount(), 2);
    assert.equal(patchMock.mock.callCount(), 0);
    assert.equal(rpcRevealMock.mock.callCount(), 0);
    assert.equal(applyRemoteMock.mock.callCount(), 2);
    assert.equal(savedTriviaSession.phase, "reveal");
    assert.equal(savedTriviaSession.questionScored, true);
  });

  it("solo : pas de RPC, saveStatePatch local", async () => {
    isGameSyncActiveMock.mock.mockImplementation(() => false);

    await commitTriviaAnswer(2);

    assert.equal(rpcSubmitMock.mock.callCount(), 0);
    assert.equal(saveStatePatchMock.mock.callCount(), 1);
    assert.equal(patchMock.mock.callCount(), 0);
  });

  it("timeout puis refresh : réponse présente, phase question", async () => {
    rpcSubmitMock.mock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    refreshMock.mock.mockImplementation(async () => ({
      lobby_id: LOBBY_ID,
      state: {
        trivia: {
          runId: RUN_ID,
          questionIdx: 0,
          phase: "question",
          questionScored: false,
          answers: {
            [HOST_UID]: { answerIndex: 1, answeredAt: 100 },
          },
        },
      },
    }));
    applyRemoteMock.mock.mockImplementation((row) => {
      if (row?.state?.trivia) savedTriviaSession = row.state.trivia;
    });

    const answer = await commitTriviaAnswer(1);
    assert.equal(answer.answerIndex, 1);
    assert.equal(refreshMock.mock.callCount(), 1);
    assert.equal(rpcSubmitMock.mock.callCount(), 1);
    assert.equal(patchMock.mock.callCount(), 0);
  });

  it("timeout puis refresh : réponse présente, phase reveal", async () => {
    rpcSubmitMock.mock.mockImplementation(async () => {
      throw new Error("network timeout");
    });
    refreshMock.mock.mockImplementation(async () =>
      revealRowFromAnswers({
        [HOST_UID]: { answerIndex: 1, answeredAt: 100 },
        [GUEST_UID]: { answerIndex: 0, answeredAt: 200 },
      })
    );
    applyRemoteMock.mock.mockImplementation((row) => {
      if (row?.state?.trivia) savedTriviaSession = row.state.trivia;
    });

    await commitTriviaAnswer(1);
    assert.equal(savedTriviaSession.phase, "reveal");
    assert.equal(refreshMock.mock.callCount(), 1);
  });

  it("timeout puis refresh : réponse absente → erreur", async () => {
    rpcSubmitMock.mock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    refreshMock.mock.mockImplementation(async () => ({
      lobby_id: LOBBY_ID,
      state: {
        trivia: {
          runId: RUN_ID,
          questionIdx: 0,
          phase: "question",
          questionScored: false,
          answers: {},
        },
      },
    }));

    await assert.rejects(() => commitTriviaAnswer(1), /impossible/i);
    assert.equal(patchMock.mock.callCount(), 0);
  });

  it("erreur métier → pas de refresh", async () => {
    rpcSubmitMock.mock.mockImplementation(async () => {
      throw new Error("TRIVIA_STALE_RUN");
    });

    await assert.rejects(() => commitTriviaAnswer(1), /autre partie/i);
    assert.equal(refreshMock.mock.callCount(), 0);
  });
});
