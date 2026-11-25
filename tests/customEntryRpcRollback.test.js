/**
 * Audit contenus perso n°1 : chez un invité, si l'envoi d'une prise Hot Take ou
 * d'un dilemme échoue, l'ajout (ou la suppression) est annulé dans l'appli et un
 * message est renvoyé, comme pour Draw It, les thèmes et Rank Live.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const LOBBY_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const state = { lobby: { id: LOBBY_ID }, hotTakeGame: null, dilemmaGame: null };
let rpcShouldFail = true;

const upsertMock = mock.fn(async () => {
  if (rpcShouldFail) throw new Error("Failed to fetch");
  return null;
});
const deleteMock = mock.fn(async () => {
  if (rpcShouldFail) throw new Error("Failed to fetch");
  return null;
});

mock.module("../js/core/gameSync.js", {
  namedExports: {
    isGameSyncActive: () => true,
    isLobbyHost: () => false,
    syncHotTakeSession: mock.fn(),
    syncDilemmaSession: mock.fn(),
    allMembersReady: () => false,
    hotTakeToRemote: (s) => s,
    dilemmaToRemote: (s) => s,
    patchGameState: mock.fn(),
    requireLocalParticipantUid: () => "uid-invite",
    getLocalParticipantUid: () => "uid-invite",
    normalizePlayerVotesMap: (v) => v || {},
    applyRemoteSession: mock.fn(),
  },
});

mock.module("../js/core/state.js", {
  namedExports: {
    getState: () => state,
    getLocalDisplayName: () => "Invité",
    saveStatePatch: (patch) => Object.assign(state, patch),
  },
});

mock.module("../js/core/players.js", {
  namedExports: { getActivePlayerNames: () => ["Hôte", "Invité"], getActivePlayers: () => [] },
});
mock.module("../js/core/lobby.js", { namedExports: { getLobbyParticipants: () => [] } });
mock.module("../js/core/patchGameStateFeedback.js", {
  namedExports: { patchGameStateWithFeedback: mock.fn() },
});
mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    launchGameWithSync: mock.fn(),
    commitHostGamePlay: mock.fn(),
    commitPrepReadyToggle: mock.fn(),
  },
});
mock.module("../js/core/gameSessionRpc.js", {
  namedExports: {
    rpcUpsertPlayerCustomEntry: (...a) => upsertMock(...a),
    rpcDeletePlayerCustomEntry: (...a) => deleteMock(...a),
  },
});
mock.module("../js/core/supabaseGame.js", {
  namedExports: { fetchGameSessionByLobby: async () => null },
});

const { addCustomTake, removeCustomTake, getHotTakeSession } = await import(
  "../js/core/hotTakeSession.js"
);
const { addCustomDilemma, removeCustomDilemma, getDilemmaSession } = await import(
  "../js/core/dilemmaSession.js"
);

describe("contenus perso : échec d'envoi chez un invité", () => {
  beforeEach(() => {
    state.hotTakeGame = null;
    state.dilemmaGame = null;
    rpcShouldFail = true;
  });

  it("Hot Take : ajout raté annulé et message renvoyé", async () => {
    const res = await addCustomTake("Les pâtes au ketchup c'est bon");
    assert.equal(res.ok, false);
    assert.match(res.error, /pas pu être enregistrée/);
    assert.equal((getHotTakeSession().customTakes || []).length, 0);
  });

  it("Hot Take : suppression ratée remet la prise", async () => {
    rpcShouldFail = false;
    assert.equal((await addCustomTake("Prise à garder")).ok, true);
    const [take] = getHotTakeSession().customTakes;
    rpcShouldFail = true;
    const res = await removeCustomTake(take.id);
    assert.equal(res.ok, false);
    assert.match(res.error, /pas pu être supprimée/);
    assert.deepEqual(
      getHotTakeSession().customTakes.map((t) => t.id),
      [take.id]
    );
  });

  it("Dilemma : ajout raté annulé et message renvoyé", async () => {
    const res = await addCustomDilemma("Voler", "Être invisible");
    assert.equal(res.ok, false);
    assert.match(res.error, /pas pu être enregistré/);
    assert.equal((getDilemmaSession().customDilemmas || []).length, 0);
  });

  it("Dilemma : suppression ratée remet le dilemme", async () => {
    rpcShouldFail = false;
    assert.equal((await addCustomDilemma("Mer", "Montagne")).ok, true);
    const [d] = getDilemmaSession().customDilemmas;
    rpcShouldFail = true;
    const res = await removeCustomDilemma(d.id);
    assert.equal(res.ok, false);
    assert.match(res.error, /pas pu être supprimé/);
    assert.deepEqual(
      getDilemmaSession().customDilemmas.map((x) => x.id),
      [d.id]
    );
  });
});

describe("contenus perso : plafonds (audit n°2)", () => {
  beforeEach(() => {
    state.hotTakeGame = null;
    state.dilemmaGame = null;
    rpcShouldFail = false;
  });

  it("Hot Take : 11e prise du même joueur refusée avant envoi", async () => {
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await addCustomTake(`Prise numéro ${i}`)).ok, true);
    }
    const calls = upsertMock.mock.callCount();
    const res = await addCustomTake("Une de trop");
    assert.equal(res.ok, false);
    assert.match(res.error, /déjà ajouté 10 prises/);
    assert.equal(upsertMock.mock.callCount(), calls, "rien n'est envoyé");
    assert.equal(getHotTakeSession().customTakes.length, 10);
  });

  it("Dilemma : refus de plafond du serveur affiché tel quel", async () => {
    const err = Object.assign(new Error("Le salon a déjà 50 contenus perso pour ce jeu : impossible d'en ajouter."), {
      hint: "CUSTOM_LIMIT_LOBBY",
    });
    upsertMock.mock.mockImplementationOnce(async () => {
      throw err;
    });
    const res = await addCustomDilemma("Thé", "Café");
    assert.equal(res.ok, false);
    assert.equal(res.error, err.message);
    assert.equal((getDilemmaSession().customDilemmas || []).length, 0);
  });
});
