/**
 * Consensus : l'envoi de la fin de partie échoue chez l'hôte.
 * Avant : l'hôte partait seul aux résultats, les invités restaient bloqués, et le
 * marqueur « complete » bloquait ce téléphone pour tout Consensus dans ce lobby.
 * Désormais : bouton de reprise qui relit la session puis rejoint les résultats
 * (fin déjà enregistrée) ou renvoie la fin de partie.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

const state = {
  lobby: { id: LOBBY_ID },
  consensusGame: { phase: "final", questionIdx: 4, podiumApplied: true, answers: {} },
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
    consensusFromRemote: (remote) => (remote ? { ...remote } : null),
    patchGameState: mock.fn(),
    fetchRawGameSessionRow: mock.fn(async () => null),
    requireLocalParticipantUid: mock.fn(() => HOST_UID),
    consensusRevealToRemote: mock.fn((s) => s),
  },
});
mock.module("../js/core/state.js", {
  namedExports: {
    getState: () => state,
    getLocalDisplayName: () => "Host",
    saveStatePatch: mock.fn(),
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

function setCompleteMarker(lobbyId = LOBBY_ID) {
  session.__setConsensusWriteMarkerForTests({
    lobbyId,
    questionIdx: 4,
    step: "complete",
    attemptId: 7,
  });
}

const inGameRow = { lobby_id: LOBBY_ID, screen: "consensus", game_id: "consensus" };
const resultsRow = { lobby_id: LOBBY_ID, screen: "results", game_id: "menu" };

describe("Consensus : reprise de la fin de partie", () => {
  beforeEach(() => {
    session.__resetConsensusWriteGuardForTests();
  });

  it("sans marqueur « fin de partie » : rien à reprendre", async () => {
    const complete = mock.fn(async () => resultsRow);
    const out = await session.resumeConsensusComplete({
      readSession: async () => inGameRow,
      complete,
    });
    assert.deepEqual(out, { done: false, reason: "not-complete" });
    assert.equal(complete.mock.callCount(), 0);
  });

  it("le marqueur « fin de partie » bloque bien ce téléphone (cause du blocage)", () => {
    setCompleteMarker();
    assert.equal(session.hasConsensusCompleteMarker(), true);
    assert.equal(session.consensusLobbyWriteBlocked(), true);
  });

  it("fin déjà enregistrée sur le serveur : marqueur retiré, pas de renvoi", async () => {
    setCompleteMarker();
    const complete = mock.fn(async () => resultsRow);
    const out = await session.resumeConsensusComplete({
      readSession: async () => resultsRow,
      complete,
    });
    assert.deepEqual(out, { done: true, reason: "already-done" });
    assert.equal(complete.mock.callCount(), 0);
    assert.equal(session.consensusLobbyWriteBlocked(), false);
  });

  it("fin pas enregistrée : renvoyée une fois, marqueur retiré si ça passe", async () => {
    setCompleteMarker();
    const complete = mock.fn(async () => resultsRow);
    const out = await session.resumeConsensusComplete({
      readSession: async () => inGameRow,
      complete,
    });
    assert.deepEqual(out, { done: true, reason: "retried" });
    assert.equal(complete.mock.callCount(), 1);
    assert.equal(session.consensusLobbyWriteBlocked(), false);
  });

  it("renvoi qui échoue encore : marqueur « fin de partie » reposé pour réessayer", async () => {
    setCompleteMarker();
    const out = await session.resumeConsensusComplete({
      readSession: async () => inGameRow,
      complete: async () => {
        throw new Error("réseau coupé");
      },
    });
    assert.deepEqual(out, { done: false, reason: "retry-failed" });
    assert.equal(session.hasConsensusCompleteMarker(), true);
  });

  it("lecture de la session impossible : on garde le marqueur, pas de renvoi", async () => {
    setCompleteMarker();
    const complete = mock.fn(async () => resultsRow);
    const out = await session.resumeConsensusComplete({
      readSession: async () => {
        throw new Error("réseau coupé");
      },
      complete,
    });
    assert.deepEqual(out, { done: false, reason: "read-failed" });
    assert.equal(complete.mock.callCount(), 0);
    assert.equal(session.hasConsensusCompleteMarker(), true);
  });

  it("session reçue sur les résultats : marqueur retiré (seulement pour ce lobby)", () => {
    setCompleteMarker();
    assert.equal(
      session.releaseConsensusCompleteMarkerIfPostGame({ ...resultsRow, lobby_id: "autre" }),
      false
    );
    assert.equal(session.releaseConsensusCompleteMarkerIfPostGame(inGameRow), false);
    assert.equal(session.hasConsensusCompleteMarker(), true);
    assert.equal(session.releaseConsensusCompleteMarkerIfPostGame(resultsRow), true);
    assert.equal(session.consensusLobbyWriteBlocked(), false);
  });

  it("un autre marqueur (réponse) n'est jamais retiré par ces fonctions", async () => {
    session.__setConsensusWriteMarkerForTests({
      lobbyId: LOBBY_ID,
      questionIdx: 2,
      step: "answer",
      attemptId: 3,
    });
    assert.equal(session.releaseConsensusCompleteMarkerIfPostGame(resultsRow), false);
    const out = await session.resumeConsensusComplete({
      readSession: async () => resultsRow,
      complete: async () => resultsRow,
    });
    assert.equal(out.reason, "not-complete");
    assert.equal(session.consensusLobbyWriteBlocked(), true);
  });
});

describe("Consensus : écran de fin de partie", () => {
  const src = fs.readFileSync(
    fileURLToPath(new URL("../js/games/consensus.js", import.meta.url)),
    "utf8"
  );
  const showResults = src.slice(
    src.indexOf("async function showEveningResults"),
    src.indexOf("function render()")
  );

  it("échec : l'hôte n'est plus envoyé seul aux résultats en multijoueur", () => {
    const mpPart = showResults.slice(0, showResults.indexOf("await setLobbyWaiting()"));
    assert.doesNotMatch(mpPart, /navigate\(/);
    assert.match(mpPart, /showAppAlert\("Vérifie ta connexion réseau et réessaie"/);
  });

  it("le bouton « Voir les résultats » passe par la reprise si un marqueur reste", () => {
    assert.match(
      showResults,
      /if \(hasConsensusCompleteMarker\(\)\) \{\s*await recheckConsensusComplete\(\);\s*return;/
    );
  });

  it("le bouton du bandeau relance la reprise « fin de partie »", () => {
    const reread = src.slice(src.indexOf("async function rereadSharedConsensus"));
    assert.match(
      reread,
      /^async function rereadSharedConsensus\(\) \{\s*if \(hasConsensusCompleteMarker\(\)\) \{\s*await recheckConsensusComplete\(\);/
    );
  });

  it("textes du bandeau pour la fin de partie", () => {
    assert.match(src, /hint: "L'affichage des résultats n'est pas confirmé\."/);
    assert.match(src, /button: "Réessayer d'afficher les résultats"/);
  });

  it("session reçue sur les résultats : le marqueur est retiré", () => {
    assert.match(
      src,
      /stopGameSessionListenerOnPostGame\(row, \{ cleanup: \(\) => \{[\s\S]{0,200}releaseConsensusCompleteMarkerIfPostGame\(row\);/
    );
  });
});
