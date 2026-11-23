/**
 * Audit Consensus n°2 : l'hôte remplaçant ne pouvait jamais passer à la question
 * suivante (écriture conditionnelle réservée au vrai hôte, puis `currentQuestion`
 * refusé par apply_acting_host_play). Il relit maintenant la partie et n'envoie que
 * les champs acceptés par le serveur.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const LOBBY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const patchMock = mock.fn(async () => ({}));
const fetchRawMock = mock.fn(async () => null);
const commitHostGamePlayMock = mock.fn(async ({ patch, getSession, saveLocal }) => {
  const next = { ...getSession(), ...patch };
  saveLocal(next);
  return next;
});

const state = { lobby: { id: LOBBY_ID }, consensusGame: null };

function revealSession() {
  return {
    lobbyStarted: true,
    phase: "reveal",
    questionIdx: 0,
    questionCount: 2,
    selectedModeId: "standard",
    deck: [
      { id: 1, question: "Première" },
      { id: 2, question: "Deuxième" },
    ],
    currentQuestion: { id: 1, question: "Première" },
    answers: { Remplaçant: { value: 40, questionIdx: 0, submittedAt: 1 } },
    matchScores: { Remplaçant: 12 },
    roundScored: true,
    lastRound: { deltas: { Remplaçant: 12 } },
  };
}

mock.module("../js/core/gameSync.js", {
  namedExports: {
    allMembersReady: mock.fn(() => false),
    isGameSyncActive: mock.fn(() => true),
    isLobbyHost: mock.fn(() => false),
    canActAsHost: mock.fn(() => true),
    playerKeyToDisplayName: mock.fn((key) => key),
    syncConsensusSession: mock.fn(),
    consensusToRemote: mock.fn((session) => session),
    consensusFromRemote: (remote) => (remote ? { ...remote } : null),
    patchGameState: patchMock,
    fetchRawGameSessionRow: (...args) => fetchRawMock(...args),
    requireLocalParticipantUid: mock.fn(() => "uid-remplacant"),
    consensusRevealToRemote: mock.fn((s) => s),
  },
});

mock.module("../js/core/state.js", {
  namedExports: {
    getState: () => state,
    getLocalDisplayName: () => "Remplaçant",
    saveStatePatch: (patch) => {
      if (patch?.consensusGame) state.consensusGame = patch.consensusGame;
    },
    addScore: mock.fn(),
    setActiveScoringGame: mock.fn(),
  },
});

mock.module("../js/core/patchGameStateFeedback.js", {
  namedExports: { patchGameStateWithFeedback: mock.fn() },
});

mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    commitHostGamePlay: commitHostGamePlayMock,
    commitPrepReadyToggle: mock.fn(),
    launchGameWithSync: mock.fn(),
  },
});

mock.module("../js/core/players.js", {
  namedExports: {
    getActivePlayerNames: mock.fn(() => ["Remplaçant", "Invité"]),
    getActivePlayers: mock.fn(() => [{ name: "Remplaçant" }, { name: "Invité" }]),
  },
});

mock.module("../js/core/lobby.js", {
  namedExports: { getLobbyParticipants: mock.fn(() => []) },
});

const session = await import("../js/core/consensusSession.js");
const { ACTING_HOST_PLAY_ALLOWED_KEYS } = await import("../js/core/gameSessionSecurity.js");

describe("Consensus : « Question suivante » chez l'hôte remplaçant", () => {
  beforeEach(() => {
    storage.clear();
    session.__resetConsensusWriteGuardForTests();
    state.consensusGame = revealSession();
    patchMock.mock.resetCalls();
    fetchRawMock.mock.resetCalls();
    commitHostGamePlayMock.mock.resetCalls();
  });

  it("relit la partie puis envoie seulement les champs acceptés par le serveur", async () => {
    fetchRawMock.mock.mockImplementation(async () => ({
      lobby_id: LOBBY_ID,
      updated_at: "t1",
      state: { consensus: { ...revealSession() } },
    }));
    const live = await session.startConsensusQuestion(1);
    assert.equal(fetchRawMock.mock.callCount(), 1);
    assert.equal(patchMock.mock.callCount(), 0, "pas d'écriture conditionnelle du vrai hôte");
    assert.equal(commitHostGamePlayMock.mock.callCount(), 1);
    const { patch } = commitHostGamePlayMock.mock.calls[0].arguments[0];
    assert.deepEqual(patch, session.actingHostQuestionStartPatch(1));
    for (const key of Object.keys(patch)) {
      assert.ok(ACTING_HOST_PLAY_ALLOWED_KEYS.has(key), key);
    }
    assert.equal("currentQuestion" in patch, false);
    assert.equal(live.questionIdx, 1);
    assert.equal(live.phase, "question");
    assert.equal(session.consensusLobbyWriteBlocked(), false, "verrou levé après succès");
  });

  it("n'écrit rien si la partie a déjà avancé (affiche ce que montre le serveur)", async () => {
    fetchRawMock.mock.mockImplementation(async () => ({
      lobby_id: LOBBY_ID,
      updated_at: "t2",
      state: {
        consensus: { ...revealSession(), phase: "question", questionIdx: 1, answers: {} },
      },
    }));
    const live = await session.startConsensusQuestion(1);
    assert.equal(commitHostGamePlayMock.mock.callCount(), 0);
    assert.equal(patchMock.mock.callCount(), 0);
    assert.equal(live.questionIdx, 1);
  });

  it("partie illisible : erreur, rien d'envoyé", async () => {
    fetchRawMock.mock.mockImplementation(async () => null);
    await assert.rejects(() => session.startConsensusQuestion(1));
    assert.equal(commitHostGamePlayMock.mock.callCount(), 0);
    assert.equal(patchMock.mock.callCount(), 0);
  });
});
