import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

const patchMock = mock.fn();
const syncMock = mock.fn();
const launchMock = mock.fn();
const isGameSyncActiveMock = mock.fn(() => true);
const canActAsHostMock = mock.fn(() => true);
const saveStatePatchMock = mock.fn();

function baseSession() {
  return {
    phase: "question",
    questionIdx: 0,
    questionCount: 5,
    selectedModeId: "standard",
    answers: {},
    matchScores: { Host: 0, Guest: 0 },
    roundScored: false,
    lastRound: null,
    currentQuestion: { id: "q1", prompt: "Test" },
  };
}

const state = {
  lobby: { id: LOBBY_ID },
  consensusGame: baseSession(),
};

function revealRemote(session) {
  return {
    phase: session.phase,
    questionIdx: session.questionIdx,
    answers: session.answers,
    matchScores: session.matchScores,
    roundScored: session.roundScored,
    lastRound: session.lastRound,
    currentQuestion: session.currentQuestion,
  };
}

mock.module("../js/core/gameSync.js", {
  namedExports: {
    allMembersReady: mock.fn(() => false),
    isGameSyncActive: isGameSyncActiveMock,
    isLobbyHost: mock.fn(() => true),
    canActAsHost: canActAsHostMock,
    playerKeyToDisplayName: mock.fn((key) => key),
    syncConsensusSession: syncMock,
    consensusToRemote: mock.fn((session) => session),
    patchGameState: patchMock,
    requireLocalParticipantUid: mock.fn(() => HOST_UID),
    consensusRevealToRemote: mock.fn(revealRemote),
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
  namedExports: { patchGameStateWithFeedback: mock.fn() },
});

mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    commitHostGamePlay: mock.fn(),
    commitPrepReadyToggle: mock.fn(),
    launchGameWithSync: launchMock,
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

function functionBody(source, name, nextName) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`);
  assert.ok(start >= 0, name);
  assert.ok(end > start, nextName);
  return source.slice(start, end);
}

describe("consensus phase commit guard", () => {
  beforeEach(() => {
    storage.clear();
    session.__resetConsensusWriteGuardForTests();
    state.consensusGame = baseSession();
    state.lobby = { id: LOBBY_ID };
    isGameSyncActiveMock.mock.mockImplementation(() => true);
    canActAsHostMock.mock.mockImplementation(() => true);
    patchMock.mock.resetCalls();
    syncMock.mock.resetCalls();
    launchMock.mock.resetCalls();
    saveStatePatchMock.mock.resetCalls();
    patchMock.mock.mockImplementation(async () => ({}));
    syncMock.mock.mockImplementation(async () => ({}));
    launchMock.mock.mockImplementation(async () => ({ ok: true }));
    saveStatePatchMock.mock.mockImplementation((patch) => {
      if (patch?.consensusGame) state.consensusGame = patch.consensusGame;
    });
  });

  it("keeps the marker after a rejection without a code and blocks later writes", async () => {
    patchMock.mock.mockImplementation(async () => {
      throw new Error("timeout");
    });
    await assert.rejects(() => session.commitConsensusPhase("reveal-pending"));
    const marker = session.__getConsensusWriteMarkerForTests();
    assert.equal(marker.lobbyId, LOBBY_ID);
    assert.equal(marker.step, "reveal-pending");
    assert.equal(marker.questionIdx, 0);
    assert.equal(state.consensusGame.phase, "question");
    assert.equal(saveStatePatchMock.mock.callCount(), 0);

    await assert.rejects(() => session.commitConsensusPhase("reveal-pending"), (err) => {
      assert.equal(err.code, "CONSENSUS_WRITE_BLOCKED");
      return true;
    });
    await assert.rejects(() => session.commitConsensusReveal({ ...baseSession(), phase: "reveal" }));
    await assert.rejects(() => session.commitConsensusAnswer(40, { submitted: true }));
    await assert.rejects(() => session.startConsensusQuestion(1));
    assert.equal(patchMock.mock.callCount(), 1);
    assert.equal(syncMock.mock.callCount(), 0);
    assert.deepEqual(session.__getConsensusWriteMarkerForTests(), marker);
  });

  it("keeps the marker after a coded rejection that follows a server write", async () => {
    patchMock.mock.mockImplementation(async () => {
      const err = new Error("fetch after update");
      err.code = "PGRST000";
      throw err;
    });
    await assert.rejects(() => session.commitConsensusPhase("reveal-pending"));
    assert.ok(session.__getConsensusWriteMarkerForTests());
    assert.equal(state.consensusGame.phase, "question");
    await assert.rejects(() => session.commitConsensusPhase("reveal-pending"));
    assert.equal(patchMock.mock.callCount(), 1);
  });

  it("clears only the matching attempt after the awaited promise fulfills", async () => {
    await session.commitConsensusPhase("reveal-pending");
    assert.equal(session.__getConsensusWriteMarkerForTests(), null);
    assert.equal(session.__getConsensusAttemptHighWaterForTests(), 1);
    await session.commitConsensusPhase("reveal-pending");
    assert.equal(session.__getConsensusAttemptHighWaterForTests(), 2);
    assert.equal(patchMock.mock.callCount(), 2);
  });

  it("does not let a stale settle or a realtime phase clear a newer marker", async () => {
    await session.commitConsensusPhase("reveal-pending");
    const attemptA = 1;
    session.__setConsensusWriteMarkerForTests({
      lobbyId: LOBBY_ID,
      questionIdx: 0,
      step: "reveal",
      attemptId: 50,
    });
    assert.equal(session.__settleConsensusServerWriteForTests(attemptA), false);
    state.consensusGame = { ...state.consensusGame, phase: "reveal", questionIdx: 3 };
    assert.equal(session.consensusLobbyWriteBlocked(), true);
    await assert.rejects(() => session.startConsensusQuestion(4));
    assert.equal(syncMock.mock.callCount(), 0);
    assert.equal(session.__getConsensusWriteMarkerForTests().attemptId, 50);
    assert.equal(session.__settleConsensusServerWriteForTests(50), true);
    assert.equal(session.__getConsensusWriteMarkerForTests(), null);
    assert.equal(session.__settleConsensusServerWriteForTests(attemptA), false);
    assert.equal(session.__getConsensusAttemptHighWaterForTests(), 1);
    await session.commitConsensusPhase("reveal-pending");
    assert.equal(session.__getConsensusAttemptHighWaterForTests(), 2);
  });

  it("refuses a second reserve while the first request is still awaited", async () => {
    let rejectPatch;
    patchMock.mock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectPatch = reject;
        })
    );
    const first = session.commitConsensusPhase("reveal-pending");
    await Promise.resolve();
    await assert.rejects(() => session.commitConsensusReveal(baseSession()));
    assert.equal(patchMock.mock.callCount(), 1);
    rejectPatch(new Error("timeout"));
    await assert.rejects(first);
    assert.ok(session.__getConsensusWriteMarkerForTests());
  });

  it("strips currentQuestion from the reveal payload", async () => {
    const scored = {
      ...baseSession(),
      phase: "reveal",
      roundScored: true,
      lastRound: { deltas: {} },
      answers: { Host: { value: 10, questionIdx: 0 } },
      matchScores: { Host: 1, Guest: 0 },
    };
    await session.commitConsensusReveal(scored);
    const payload = patchMock.mock.calls[0].arguments[0].consensus;
    assert.equal(Object.hasOwn(payload, "currentQuestion"), false);
    assert.equal(payload.phase, "reveal");
    assert.equal(payload.answers, scored.answers);
    assert.equal(payload.matchScores, scored.matchScores);
    assert.equal(payload.roundScored, true);
    assert.deepEqual(payload.lastRound, scored.lastRound);
  });

  it("refreshes once a confirmed launch has actually removed the marker", async () => {
    let blockedDuringLaunch = null;
    let refreshes = 0;
    let blockedAtRefresh = null;
    let patchAtRefresh = 0;
    let launchAtRefresh = 0;
    let saveAtRefresh = 0;
    let answersAtRefresh = null;
    launchMock.mock.mockImplementation(async () => {
      blockedDuringLaunch = session.consensusLobbyWriteBlocked();
      return { ok: true };
    });
    const unsubscribe = session.subscribeConsensusLaunchEnded(() => {
      refreshes += 1;
      blockedAtRefresh = session.consensusLobbyWriteBlocked();
      patchAtRefresh = patchMock.mock.callCount();
      launchAtRefresh = launchMock.mock.callCount();
      saveAtRefresh = saveStatePatchMock.mock.callCount();
      answersAtRefresh = state.consensusGame.answers;
    });
    try {
      const result = await session.markConsensusLobbyStarted();
      assert.equal(result.ok, true);
      assert.equal(blockedDuringLaunch, true);
      assert.equal(session.__getConsensusWriteMarkerForTests(), null);
      assert.equal(refreshes, 1);
      assert.equal(blockedAtRefresh, false);
      assert.equal(patchMock.mock.callCount(), 0);
      assert.equal(syncMock.mock.callCount(), 0);
      assert.equal(launchMock.mock.callCount(), 1);
      assert.equal(patchMock.mock.callCount(), patchAtRefresh);
      assert.equal(launchMock.mock.callCount(), launchAtRefresh);
      assert.equal(saveStatePatchMock.mock.callCount(), saveAtRefresh);
      assert.equal(state.consensusGame.answers, answersAtRefresh);
    } finally {
      unsubscribe();
    }
  });

  it("keeps the block visible when the launch reports a fallback", async () => {
    launchMock.mock.mockImplementation(async () => ({ ok: false, usedFallback: true }));
    let blockedAtRefresh = null;
    const unsubscribe = session.subscribeConsensusLaunchEnded(() => {
      blockedAtRefresh = session.consensusLobbyWriteBlocked();
    });
    try {
      const result = await session.markConsensusLobbyStarted();
      assert.equal(result.usedFallback, true);
      assert.equal(blockedAtRefresh, true);
      assert.equal(session.__getConsensusWriteMarkerForTests().step, "lobby-start");
      assert.equal(patchMock.mock.callCount(), 0);
      assert.equal(launchMock.mock.callCount(), 1);
    } finally {
      unsubscribe();
    }
  });

  it("keeps the block visible when the launch times out", async () => {
    launchMock.mock.mockImplementation(async () => {
      throw new Error("Synchronisation trop longue.");
    });
    let refreshes = 0;
    let blockedAtRefresh = null;
    const unsubscribe = session.subscribeConsensusLaunchEnded(() => {
      refreshes += 1;
      blockedAtRefresh = session.consensusLobbyWriteBlocked();
    });
    try {
      await assert.rejects(() => session.markConsensusLobbyStarted(), /Synchronisation trop longue/);
      assert.equal(refreshes, 1);
      assert.equal(blockedAtRefresh, true);
      assert.equal(session.__getConsensusWriteMarkerForTests().step, "lobby-start");
      assert.equal(patchMock.mock.callCount(), 0);
      assert.equal(launchMock.mock.callCount(), 1);
    } finally {
      unsubscribe();
    }
  });

  it("does not unlock the screen when a newer marker replaced the launch attempt", async () => {
    launchMock.mock.mockImplementation(async () => {
      session.__setConsensusWriteMarkerForTests({
        lobbyId: LOBBY_ID,
        questionIdx: 0,
        step: "answer",
        attemptId: 999,
      });
      return { ok: true };
    });
    let blockedAtRefresh = null;
    const unsubscribe = session.subscribeConsensusLaunchEnded(() => {
      blockedAtRefresh = session.consensusLobbyWriteBlocked();
    });
    try {
      await session.markConsensusLobbyStarted();
      assert.equal(blockedAtRefresh, true);
      assert.equal(session.__getConsensusWriteMarkerForTests().attemptId, 999);
      assert.equal(session.__getConsensusWriteMarkerForTests().step, "answer");
      assert.equal(patchMock.mock.callCount(), 0);
    } finally {
      unsubscribe();
    }
  });

  it("stops refreshing after the Consensus screen unsubscribes", async () => {
    let refreshes = 0;
    const unsubscribe = session.subscribeConsensusLaunchEnded(() => {
      refreshes += 1;
    });
    unsubscribe();
    launchMock.mock.mockImplementation(async () => ({ ok: true }));
    await session.markConsensusLobbyStarted();
    assert.equal(refreshes, 0);
    assert.equal(session.__getConsensusWriteMarkerForTests(), null);
  });

  it("does not signal the screen on a solo launch or a later round", async () => {
    let refreshes = 0;
    const unsubscribe = session.subscribeConsensusLaunchEnded(() => {
      refreshes += 1;
    });
    try {
      isGameSyncActiveMock.mock.mockImplementation(() => false);
      await session.markConsensusLobbyStarted();
      assert.equal(refreshes, 0);
      assert.equal(session.__getConsensusWriteMarkerForTests(), null);
      isGameSyncActiveMock.mock.mockImplementation(() => true);
      state.consensusGame = {
        ...state.consensusGame,
        phase: "reveal",
        deck: [
          { id: "q1", question: "Première" },
          { id: "q2", question: "Deuxième" },
        ],
      };
      patchMock.mock.mockImplementation(async (body) => {
        const remote = body.consensus;
        state.consensusGame = {
          ...state.consensusGame,
          questionIdx: remote.questionIdx,
          phase: remote.phase,
          currentQuestion: remote.currentQuestion,
          answers: {},
        };
      });
      await session.startConsensusQuestion(1);
      assert.equal(refreshes, 0);
    } finally {
      unsubscribe();
    }
  });

  it("keeps the marker when the initial launch reports a fallback retry", async () => {
    launchMock.mock.mockImplementation(async () => ({ ok: false, usedFallback: true }));
    const result = await session.markConsensusLobbyStarted();
    assert.equal(result.usedFallback, true);
    assert.equal(result.ok, false);
    assert.equal(session.__getConsensusWriteMarkerForTests().step, "lobby-start");
    assert.equal(launchMock.mock.callCount(), 1);
  });

  function revealSession() {
    return {
      phase: "reveal",
      questionIdx: 0,
      questionCount: 2,
      selectedModeId: "standard",
      lobbyStarted: true,
      deck: [
        { id: "q1", question: "Première" },
        { id: "q2", question: "Deuxième" },
      ],
      currentQuestion: { id: "q1", question: "Première" },
      answers: {
        Host: { value: 20, timestamp: 1, submittedAt: 1, questionIdx: 0, imputed: false },
      },
      matchScores: { Host: 1, Guest: 0 },
      roundScored: true,
      lastRound: { deltas: { Host: 1 } },
    };
  }

  async function rejectNextQuestion(reject) {
    state.consensusGame = revealSession();
    const before = JSON.stringify(state.consensusGame);
    patchMock.mock.mockImplementation(async () => {
      reject();
    });
    await assert.rejects(() => session.startConsensusQuestion(1));
    assert.equal(JSON.stringify(state.consensusGame), before);
    assert.equal(saveStatePatchMock.mock.callCount(), 0);
    assert.equal(session.__getConsensusWriteMarkerForTests().step, "next-question");
    await assert.rejects(() => session.startConsensusQuestion(1));
    assert.equal(patchMock.mock.callCount(), 1);
    assert.equal(syncMock.mock.callCount(), 0);
  }

  it("shows the next question only after the server write is confirmed", async () => {
    state.consensusGame = revealSession();
    let seenDuringSend = null;
    patchMock.mock.mockImplementation(async (body) => {
      seenDuringSend = {
        phase: state.consensusGame.phase,
        questionIdx: state.consensusGame.questionIdx,
      };
      const remote = body.consensus;
      state.consensusGame = {
        ...state.consensusGame,
        questionIdx: remote.questionIdx,
        phase: remote.phase,
        currentQuestion: remote.currentQuestion,
        answers: {},
        roundScored: false,
        lastRound: null,
      };
    });
    const result = await session.startConsensusQuestion(1);
    assert.equal(seenDuringSend.phase, "reveal");
    assert.equal(seenDuringSend.questionIdx, 0);
    assert.equal(result.phase, "question");
    assert.equal(result.questionIdx, 1);
    assert.equal(result.currentQuestion.id, "q2");
    assert.equal(state.consensusGame.questionIdx, 1);
    assert.equal(session.__getConsensusWriteMarkerForTests(), null);
    assert.equal(saveStatePatchMock.mock.callCount(), 0);
    assert.equal(syncMock.mock.callCount(), 0);
  });

  it("keeps the confirmed reveal after a rejection without a code", async () => {
    await rejectNextQuestion(() => {
      throw new Error("network down");
    });
  });

  it("keeps the confirmed reveal after a coded rejection", async () => {
    await rejectNextQuestion(() => {
      const err = new Error("fetch after update");
      err.code = "PGRST000";
      throw err;
    });
  });

  it("keeps the confirmed reveal after a timeout", async () => {
    await rejectNextQuestion(() => {
      throw new Error("Synchronisation trop longue.");
    });
  });

  it("does not reapply a prepared question over a newer remote state", async () => {
    state.consensusGame = revealSession();
    patchMock.mock.mockImplementation(async () => {
      state.consensusGame = {
        ...state.consensusGame,
        phase: "question",
        questionIdx: 2,
        currentQuestion: { id: "newer", question: "Plus récente" },
        answers: {},
        roundScored: false,
        lastRound: null,
      };
    });
    const result = await session.startConsensusQuestion(1);
    assert.equal(result.questionIdx, 2);
    assert.equal(result.currentQuestion.id, "newer");
    assert.equal(state.consensusGame.questionIdx, 2);
    assert.equal(saveStatePatchMock.mock.callCount(), 0);
    assert.equal(session.__getConsensusWriteMarkerForTests().step, "next-question");
    await assert.rejects(() => session.startConsensusQuestion(3));
    assert.equal(patchMock.mock.callCount(), 1);
    assert.equal(state.consensusGame.currentQuestion.id, "newer");
  });

  it("keeps the solo next question on the local path", async () => {
    isGameSyncActiveMock.mock.mockImplementation(() => false);
    state.consensusGame = revealSession();
    const result = await session.startConsensusQuestion(1);
    assert.equal(result.questionIdx, 1);
    assert.equal(result.phase, "question");
    assert.equal(patchMock.mock.callCount(), 0);
    assert.equal(syncMock.mock.callCount(), 1);
    assert.equal(syncMock.mock.calls[0].arguments[0].questionIdx, 1);
    assert.equal(session.__getConsensusWriteMarkerForTests(), null);
  });

  it("does not launch again while a marker is already set", async () => {
    session.__setConsensusWriteMarkerForTests({
      lobbyId: LOBBY_ID,
      questionIdx: 0,
      step: "reveal",
      attemptId: 4,
    });
    const result = await session.markConsensusLobbyStarted();
    assert.equal(result.blocked, true);
    assert.equal(launchMock.mock.callCount(), 0);
    assert.equal(session.__getConsensusWriteMarkerForTests().attemptId, 4);
  });
});

describe("consensus launch and reveal source contracts", () => {
  const restartSrc = fs.readFileSync(new URL("../js/core/restartGame.js", import.meta.url), "utf8");
  const gameSrc = fs.readFileSync(new URL("../js/games/consensus.js", import.meta.url), "utf8");
  const selectSrc = fs.readFileSync(new URL("../js/screens/gameSelect.js", import.meta.url), "utf8");
  const sessionSrc = fs.readFileSync(new URL("../js/core/consensusSession.js", import.meta.url), "utf8");

  it("guards every Consensus prep launch before a local or remote write", () => {
    const body = functionBody(restartSrc, "launchConsensusPrep", "launchHotTakePrep");
    const open = body.indexOf("{");
    assert.match(body.slice(open), /^\{\s*if \(consensusLobbyWriteBlocked\(\)\) return;/);
    assert.ok(body.indexOf("consensusLobbyWriteBlocked") < body.indexOf("saveStatePatch"));
    assert.ok(body.indexOf("consensusLobbyWriteBlocked") < body.indexOf("commitPrepSessionLaunch"));
    assert.match(selectSrc, /"consensus-prep":\s*launchConsensusPrep/);
    assert.match(restartSrc, /consensus:\s*launchConsensusPrep/);
    assert.match(restartSrc, /return restartGame\(sessionId\)/);
  });

  it("does not save an advanced phase or retry a reveal from the UI catch", () => {
    const pendingFn = gameSrc.slice(
      gameSrc.indexOf("async function goToRevealPending"),
      gameSrc.indexOf("async function forceReveal")
    );
    const revealFn = gameSrc.slice(
      gameSrc.indexOf("async function goToReveal()"),
      gameSrc.indexOf("async function openConsensusSetup")
    );
    assert.equal(pendingFn.includes("void consensus.commitPhase"), false);
    assert.equal(pendingFn.includes("la révélation continue chez toi"), false);
    const pendingCatch = pendingFn.slice(pendingFn.indexOf("} catch"));
    assert.equal(pendingCatch.includes("saveStatePatch"), false);
    assert.equal(revealFn.includes("saveStatePatch"), false);
    assert.equal(revealFn.includes("void syncRevealToRemote"), false);
    assert.match(revealFn, /scoreFlagsCoherent\(base\)/);
    assert.ok(revealFn.indexOf("scoreFlagsCoherent(base)") < revealFn.indexOf("syncRevealToRemote"));
    assert.match(sessionSrc, /delete remote\.currentQuestion/);
    const nextQuestion = sessionSrc.slice(
      sessionSrc.indexOf("export async function startConsensusQuestion"),
      sessionSrc.indexOf("export async function commitConsensusPlay")
    );
    assert.match(nextQuestion, /patchGameState\(\{ consensus: consensusToRemote\(next\) \}/);
    assert.equal(nextQuestion.includes("syncConsensusSession(next)"), true);
    const multiplayerBranch = nextQuestion.slice(nextQuestion.indexOf("reserveConsensusServerWrite"));
    assert.equal(multiplayerBranch.includes("syncConsensusSession"), false);
    assert.match(gameSrc, /writesBlocked\(\) \? "blocked" : "open"/);
    assert.match(gameSrc, /interactionBlocked: writesBlocked\(\)/);
    const syncSrc = fs.readFileSync(new URL("../js/core/gameSync.js", import.meta.url), "utf8");
    const syncFn = syncSrc.slice(
      syncSrc.indexOf("export async function syncConsensusSession"),
      syncSrc.indexOf("export async function syncDilemmaSession")
    );
    assert.ok(syncFn.indexOf("saveStatePatch") < syncFn.indexOf("patchGameState"));
    const refresh = gameSrc.slice(
      gameSrc.indexOf("const unsubscribeLaunchEnded = subscribeConsensusLaunchEnded"),
      gameSrc.indexOf("if (\n    mp &&\n    canActAsHost()")
    );
    assert.match(refresh, /if \(!mount\.isMounted\(\)\) return;/);
    assert.match(refresh, /if \(!mount\.isCurrentMount\(\)\) return;\s*render\(\);/);
    assert.equal(refresh.includes("navigate("), false);
    assert.equal(refresh.includes("saveStatePatch"), false);
    assert.equal(refresh.includes("patchGameState"), false);
    assert.equal(refresh.includes("launchGameWithSync"), false);
    const cleanup = gameSrc.slice(gameSrc.lastIndexOf("return () => {"));
    assert.match(cleanup, /unsubscribeLaunchEnded\(\)/);
  });

  it("executes the three prep launch paths without writing while a marker is set", () => {
    const script = `
      const storage = new Map();
      globalThis.localStorage = {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      };
      const { saveStatePatch, getState } = await import("./js/core/state.js");
      const { isGameSyncActive } = await import("./js/core/gameSync.js");
      const session = await import("./js/core/consensusSession.js");
      const { launchConsensusPrep, restartGame, launchCatalogGame } = await import("./js/core/restartGame.js");
      const lobbyId = "consensus-guard-lobby";
      saveStatePatch({
        lobby: { id: lobbyId, hostId: "host", participants: [] },
        consensusGame: { phase: "question", questionIdx: 2, markerProbe: "kept" },
      });
      if (!isGameSyncActive()) {
        console.error("SYNC_INACTIVE");
        process.exit(2);
      }
      session.__setConsensusWriteMarkerForTests({
        lobbyId,
        questionIdx: 2,
        step: "reveal",
        attemptId: 7,
      });
      const before = JSON.stringify(getState().consensusGame);
      await launchConsensusPrep();
      await restartGame("consensus");
      await launchCatalogGame("consensus-prep");
      if (JSON.stringify(getState().consensusGame) !== before) {
        console.error("LOCAL_WRITE");
        process.exit(1);
      }
      if (session.__getConsensusWriteMarkerForTests()?.attemptId !== 7) {
        console.error("MARKER_CHANGED");
        process.exit(1);
      }
      console.log("OK");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /OK/);
  });
});
