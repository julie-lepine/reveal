import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderConsensusQuestion } from "../js/consensus/ConsensusQuestion.js";

const LOBBY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HOST_UID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: (key) => {
    storage.delete(key);
  },
};

const feedbackMock = mock.fn();
const saveStatePatchMock = mock.fn();

function guestAnswer() {
  return {
    value: 40,
    timestamp: 1,
    submittedAt: 1,
    questionIdx: 0,
    imputed: false,
  };
}

function baseSession() {
  return {
    phase: "question",
    questionIdx: 0,
    answers: { Guest: guestAnswer() },
    matchScores: { Host: 0, Guest: 0 },
    roundScored: false,
    lastRound: null,
  };
}

const state = {
  lobby: { id: LOBBY_ID },
  consensusGame: baseSession(),
};

mock.module("../js/core/gameSync.js", {
  namedExports: {
    allMembersReady: mock.fn(() => false),
    isGameSyncActive: mock.fn(() => true),
    isLobbyHost: mock.fn(() => true),
    canActAsHost: mock.fn(() => true),
    playerKeyToDisplayName: mock.fn((key) => key),
    syncConsensusSession: mock.fn(),
    consensusToRemote: mock.fn((session) => session),
    patchGameState: mock.fn(),
    requireLocalParticipantUid: mock.fn(() => HOST_UID),
    consensusRevealToRemote: mock.fn((session) => session),
  },
});

mock.module("../js/core/state.js", {
  namedExports: {
    getState: () => state,
    getLocalDisplayName: () => "Host",
    saveStatePatch: saveStatePatchMock,
    addScore: mock.fn(),
    setActiveScoringGame: mock.fn(),
  },
});

mock.module("../js/core/patchGameStateFeedback.js", {
  namedExports: { patchGameStateWithFeedback: feedbackMock },
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
    getActivePlayers: mock.fn(() => [{ name: "Host" }, { name: "Guest" }]),
  },
});

mock.module("../js/core/lobby.js", {
  namedExports: {
    getLobbyParticipants: mock.fn(() => [{ userId: HOST_UID, name: "Host" }]),
  },
});

const session = await import("../js/core/consensusSession.js");

describe("consensus answer rollback", () => {
  beforeEach(() => {
    storage.clear();
    session.__resetConsensusWriteGuardForTests();
    state.consensusGame = baseSession();
    state.lobby = { id: LOBBY_ID };
    feedbackMock.mock.resetCalls();
    saveStatePatchMock.mock.resetCalls();
    saveStatePatchMock.mock.mockImplementation((patch) => {
      if (patch?.consensusGame) state.consensusGame = patch.consensusGame;
    });
  });

  it("rolls back only the local player after a rejection without a code", async () => {
    const guest = state.consensusGame.answers.Guest;
    feedbackMock.mock.mockImplementation(async () => {
      throw new Error("timeout");
    });
    await assert.rejects(() => session.commitConsensusAnswer(70, { submitted: true }));
    assert.equal(state.consensusGame.answers.Host, undefined);
    assert.equal(state.consensusGame.answers.Guest, guest);
    assert.equal(session.__getConsensusWriteMarkerForTests().step, "answer");
    await assert.rejects(() => session.commitConsensusAnswer(70, { submitted: true }));
    assert.equal(feedbackMock.mock.callCount(), 1);
  });

  it("keeps the marker after a coded rejection and does not send again", async () => {
    feedbackMock.mock.mockImplementation(async () => {
      const err = new Error("rpc");
      err.code = "PGRST000";
      throw err;
    });
    await assert.rejects(() => session.commitConsensusAnswer(55, { submitted: true }));
    assert.ok(session.__getConsensusWriteMarkerForTests());
    assert.equal(state.consensusGame.answers.Host, undefined);
    await assert.rejects(() => session.commitConsensusAnswer(55, { submitted: true }));
    assert.equal(feedbackMock.mock.callCount(), 1);
  });

  it("does not roll back a newer answer attempt from an older rejection", async () => {
    feedbackMock.mock.mockImplementation(async () => {
      session.__setConsensusAnswerAttemptForTests(99);
      throw new Error("late");
    });
    await assert.rejects(() => session.commitConsensusAnswer(61, { submitted: true }));
    assert.equal(state.consensusGame.answers.Host.value, 61);
    assert.equal(state.consensusGame.answers.Guest.value, 40);
    assert.ok(session.__getConsensusWriteMarkerForTests());
  });

  it("does not roll back an answer object replaced during the request", async () => {
    const replacement = {
      value: 12,
      timestamp: 9,
      submittedAt: 9,
      questionIdx: 0,
      imputed: false,
    };
    feedbackMock.mock.mockImplementation(async () => {
      state.consensusGame = {
        ...state.consensusGame,
        answers: { ...state.consensusGame.answers, Host: replacement },
      };
      throw new Error("echo");
    });
    await assert.rejects(() => session.commitConsensusAnswer(80, { submitted: true }));
    assert.equal(state.consensusGame.answers.Host, replacement);
    assert.equal(state.consensusGame.answers.Guest.value, 40);
    assert.ok(session.__getConsensusWriteMarkerForTests());
  });

  it("shows a disabled validate button and the blocked message", () => {
    const html = renderConsensusQuestion({
      question: { id: "q", question: "Test" },
      questionIdx: 0,
      totalQuestions: 5,
      interactionBlocked: true,
      blockedMessage:
        "Une synchro Consensus n'est pas confirmée. La réponse ne peut plus être envoyée.",
      waitingMessage: "Choisis une valeur entre 0 et 100 puis valide.",
    });
    assert.match(html, /id="btn-consensus-submit" disabled/);
    assert.match(html, /ne peut plus être envoyée/);
    assert.equal(html.includes("Déplace le slider puis valide."), false);
    assert.equal(html.includes("Choisis une valeur entre 0 et 100 puis valide."), false);
    assert.match(html, /id="consensus-slider"[\s\S]*disabled/);
  });

  it("wires the question render key to the write marker", () => {
    const src = fs.readFileSync(new URL("../js/games/consensus.js", import.meta.url), "utf8");
    assert.match(src, /writesBlocked\(\) \? "blocked" : "open"/);
    assert.match(src, /interactionBlocked: writesBlocked\(\)/);
    assert.match(
      src,
      /Une synchro Consensus n'est pas confirmée\. La réponse ne peut plus être envoyée\./
    );
  });

  it("clears the marker only after the awaited answer promise fulfills", async () => {
    feedbackMock.mock.mockImplementation(async () => ({}));
    await session.commitConsensusAnswer(33, { submitted: true });
    assert.equal(session.__getConsensusWriteMarkerForTests(), null);
    assert.equal(state.consensusGame.answers.Host.value, 33);
    assert.equal(session.__getConsensusAttemptHighWaterForTests(), 1);
  });
});
