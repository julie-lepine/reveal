/**
 * Clutch : « Manche suivante » dont l'envoi échoue. Le téléphone de l'hôte doit revenir
 * à la manche affichée chez les invités ; sinon il lançait la nouvelle manche seul
 * au prochain événement (jeu décalé entre l'hôte et les invités).
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Clutch : « Manche suivante » qui échoue", () => {
  let savedSession;
  let sendShouldFail;
  const saveStatePatchMock = mock.fn((patch) => {
    if (patch.clutchGame) savedSession = patch.clutchGame;
  });
  // Comme le vrai syncClutchSession : enregistre en local AVANT d'envoyer.
  const syncClutchSessionMock = mock.fn(async (next) => {
    savedSession = next;
    if (sendShouldFail) throw new Error("réseau coupé");
    return next;
  });

  let startClutchRound;
  let CLUTCH_NEXT_ROUND_FAILED_LABEL;

  beforeEach(async () => {
    savedSession = {
      lobbyStarted: true,
      roundCount: 5,
      roundIdx: 1,
      phase: "reveal",
      targetMs: 4000,
      roundScored: true,
      taps: { Alice: { ms: 4100, at: 1 } },
      lastRound: { targetMs: 4000, ranking: [], deltas: {} },
      matchScores: { Alice: 3 },
    };
    sendShouldFail = false;
    saveStatePatchMock.mock.resetCalls();
    syncClutchSessionMock.mock.resetCalls();

    mock.module("../js/core/gameSync.js", {
      namedExports: {
        isGameSyncActive: mock.fn(() => true),
        requireLocalParticipantUid: mock.fn(() => "uid-alice"),
        syncClutchSession: syncClutchSessionMock,
        allMembersReady: mock.fn(),
        clutchToRemote: mock.fn((s) => s),
        patchGameState: mock.fn(),
      },
    });
    mock.module("../js/core/lobby.js", {
      namedExports: {
        getLobbyParticipants: mock.fn(() => []),
        setLobbyPlaying: mock.fn(),
      },
    });
    mock.module("../js/core/state.js", {
      namedExports: {
        getState: mock.fn(() => ({ lobby: { id: "lobby-1" }, clutchGame: savedSession })),
        getLocalDisplayName: mock.fn(() => "Alice"),
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
      namedExports: { getActivePlayerNames: mock.fn(() => ["Alice", "Bob"]) },
    });
    mock.module("../js/core/authErrors.js", {
      namedExports: { formatSyncErrorMessage: (m) => String(m || "err") },
    });
    mock.module("../js/core/dialog.js", {
      namedExports: { showAppAlert: mock.fn(async () => {}) },
    });

    const mod = await import("../js/core/clutchSession.js");
    startClutchRound = mod.startClutchRound;
    CLUTCH_NEXT_ROUND_FAILED_LABEL = mod.CLUTCH_NEXT_ROUND_FAILED_LABEL;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("échec : l'hôte revient au verdict de la manche en cours, l'erreur remonte", async () => {
    sendShouldFail = true;
    await assert.rejects(() => startClutchRound(2), /réseau coupé/);
    assert.equal(savedSession.roundIdx, 1);
    assert.equal(savedSession.phase, "reveal");
    assert.equal(savedSession.roundScored, true);
    assert.equal(savedSession.taps.Alice.ms, 4100);
    assert.deepEqual(savedSession.matchScores, { Alice: 3 });
  });

  it("succès : la nouvelle manche est bien enregistrée", async () => {
    await startClutchRound(2);
    assert.equal(savedSession.roundIdx, 2);
    assert.equal(savedSession.phase, "active");
    assert.deepEqual(savedSession.taps, {});
    assert.equal(savedSession.roundScored, false);
    assert.deepEqual(savedSession.matchScores, { Alice: 3 });
  });

  it("message affiché à l'hôte", () => {
    assert.equal(CLUTCH_NEXT_ROUND_FAILED_LABEL, "La manche suivante n’est pas partie, réessaie !");
  });

  it("l'écran Clutch attrape l'échec et affiche le message sous le bouton", () => {
    const src = readFileSync(join(__dirname, "../js/games/clutch.js"), "utf8");
    assert.match(
      src,
      /try \{\s*await startClutchRound\(roundIdx \+ 1\);\s*\} catch \(e\) \{[\s\S]*?nextRoundFailed = true;\s*render\(\);\s*return;/
    );
    assert.match(src, /nextRoundFailed\s*\?\s*`<p class="hint">\$\{escapeHtml\(CLUTCH_NEXT_ROUND_FAILED_LABEL\)\}<\/p>`/);
  });
});
