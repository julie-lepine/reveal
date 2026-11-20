/**
 * Truth Meter : fin de partie dont l'envoi échoue (bouton « Voir les résultats »
 * ou « Passer cet auteur (absent) » au dernier tour).
 * Avant : l'hôte partait seul aux résultats, les invités restaient sur
 * « En attente de l'hôte… ». Désormais : pas de navigation, l'hôte reste sur le
 * jeu, voit un message et peut réessayer.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOBBY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("finishTruthMeterGameSession : envoi de la fin de partie", () => {
  let completeShouldFail;
  const completeMock = mock.fn(async () => {
    if (completeShouldFail) throw new Error("réseau coupé");
    return { screen: "results" };
  });
  const navigateMock = mock.fn();
  let finishTruthMeterGameSession;

  beforeEach(async () => {
    completeShouldFail = false;
    completeMock.mock.resetCalls();
    navigateMock.mock.resetCalls();

    mock.module("../js/core/gameSync.js", {
      namedExports: {
        isGameSyncActive: mock.fn(() => true),
        completeGameSession: completeMock,
        applyRemoteSession: mock.fn(),
        refreshGameSession: mock.fn(),
        truthMeterToRemote: mock.fn(),
        syncTruthMeterSession: mock.fn(),
        requireLocalParticipantUid: mock.fn(() => "uid-alice"),
        getLocalParticipantUid: mock.fn(() => "uid-alice"),
        nameForUserId: mock.fn(() => null),
        isLobbyHost: mock.fn(() => true),
        canActAsHost: mock.fn(() => true),
        allMembersReady: mock.fn(),
        patchGameState: mock.fn(),
        normalizePlayerVotesMap: (votes) => votes || {},
      },
    });
    mock.module("../js/core/router.js", {
      namedExports: { navigate: navigateMock },
    });
    mock.module("../js/core/lobby.js", {
      namedExports: {
        getLobbyParticipants: mock.fn(() => []),
        setLobbyPlaying: mock.fn(),
        setLobbyWaiting: mock.fn(),
      },
    });
    mock.module("../js/core/state.js", {
      namedExports: {
        getState: mock.fn(() => ({
          lobby: { id: LOBBY_ID },
          truthMeterGame: {
            phase: "reveal",
            roundIdx: 2,
            authorOrder: ["Alice", "Bob", "Chloé"],
            lastRound: { groupAvg: 60 },
            lobbyStarted: true,
          },
        })),
        getLocalDisplayName: mock.fn(() => "Alice"),
        saveStatePatch: mock.fn(),
        addScore: mock.fn(),
        bumpPlayerStat: mock.fn(),
        recordTruthMeterPlayed: mock.fn(),
        setLastGame: mock.fn(),
        setLobbyWaiting: mock.fn(),
      },
    });
    mock.module("../js/core/dialog.js", {
      namedExports: { showAppAlert: mock.fn(async () => {}) },
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
        getActivePlayerNames: mock.fn(() => ["Alice", "Bob", "Chloé"]),
        getActivePlayers: mock.fn(() => []),
      },
    });
    mock.module("../js/core/authErrors.js", {
      namedExports: { formatSyncErrorMessage: (m) => (m ? String(m) : "") },
    });
    mock.module("../js/core/hotTakeSession.js", {
      namedExports: { checkHotTakeModeration: mock.fn(() => ({ blocked: false })) },
    });

    const mod = await import("../js/core/truthMeterSession.js");
    finishTruthMeterGameSession = mod.finishTruthMeterGameSession;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("échec : résultat « complete-failed » et aucune navigation", async () => {
    completeShouldFail = true;
    const out = await finishTruthMeterGameSession();
    assert.deepEqual(out, { ok: false, reason: "complete-failed" });
    assert.equal(completeMock.mock.callCount(), 1);
    assert.equal(navigateMock.mock.callCount(), 0);
  });

  it("succès : fin enregistrée puis passage aux résultats", async () => {
    const out = await finishTruthMeterGameSession();
    assert.deepEqual(out, { ok: true });
    assert.equal(navigateMock.mock.callCount(), 1);
    assert.equal(navigateMock.mock.calls[0].arguments[0], "results");
  });
});

describe("Truth Meter : écran quand la fin de partie échoue", () => {
  const screen = readFileSync(join(ROOT, "js/games/truthMeter.js"), "utf8");
  const session = readFileSync(join(ROOT, "js/core/truthMeterSession.js"), "utf8");

  it("« Passer cet auteur » au dernier tour remonte l'échec", () => {
    assert.match(
      session,
      /const finished = await finishTruthMeterGameSession\(\);\s*if \(!finished\.ok\) return \{ ok: false, reason: finished\.reason \};/
    );
    assert.match(screen, /if \(res\?\.reason === "complete-failed"\) finishFailed = true;/);
  });

  it("« Voir les résultats » : message et l'hôte reste sur le verdict", () => {
    assert.match(
      screen,
      /const finished = await finishTruthMeterGameSession\(\);\s*if \(!finished\.ok\) \{[\s\S]*?finishFailed = true;\s*render\(\);/
    );
  });

  it("le message est affiché sous les deux boutons", () => {
    assert.match(
      screen,
      /finishFailed \? `<p class="hint">\$\{escapeHtml\(POST_GAME_FINISH_FAILED_LABEL\)\}<\/p>` : ""/
    );
    assert.match(screen, /"Voir les résultats →"\}\s*<\/button>[\s\S]{0,300}?\$\{finishFailedHtml\(\)\}/);
    assert.match(screen, /Passer cet auteur \(absent\)\s*<\/button>\$\{finishFailedHtml\(\)\}/);
  });
});
