/**
 * Clutch, échec d'envoi d'un tap :
 * - plus de fenêtre d'alerte (elle cachait le jeu et gelait le bouton tant qu'elle
 *   restait ouverte) : l'erreur remonte tout de suite à l'écran ;
 * - temps écoulé pendant l'envoi : le bouton ne se rouvre pas, message dédié.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUTCH_TAP_FAILED_LATE_LABEL } from "../js/core/clutchTapCommit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("commitClutchTap : échec sans fenêtre d'alerte", () => {
  let savedSession;
  const showAppAlertMock = mock.fn(async () => {});
  const patchMock = mock.fn(async () => {
    throw new Error("réseau coupé");
  });
  let commitClutchTap;

  beforeEach(async () => {
    savedSession = { phase: "active", roundIdx: 0, taps: {}, lobbyStarted: true };
    showAppAlertMock.mock.resetCalls();
    patchMock.mock.resetCalls();

    mock.module("../js/core/gameSync.js", {
      namedExports: {
        isGameSyncActive: mock.fn(() => true),
        requireLocalParticipantUid: mock.fn(() => UID),
        syncClutchSession: mock.fn(),
        allMembersReady: mock.fn(),
        clutchToRemote: mock.fn((s) => s),
        patchGameState: patchMock,
      },
    });
    mock.module("../js/core/lobby.js", {
      namedExports: {
        getLobbyParticipants: mock.fn(() => [{ userId: UID, name: "Alice" }]),
        setLobbyPlaying: mock.fn(),
      },
    });
    mock.module("../js/core/state.js", {
      namedExports: {
        getState: mock.fn(() => ({ lobby: { id: "lobby-1" }, clutchGame: savedSession })),
        getLocalDisplayName: mock.fn(() => "Alice"),
        saveStatePatch: mock.fn((patch) => {
          if (patch.clutchGame) savedSession = patch.clutchGame;
        }),
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
    mock.module("../js/core/dialog.js", {
      namedExports: { showAppAlert: showAppAlertMock },
    });

    const mod = await import("../js/core/clutchSession.js");
    commitClutchTap = mod.commitClutchTap;
    mod.__resetClutchTapAttemptIdForTests();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("l'erreur remonte, le tap est annulé, aucune fenêtre d'alerte", async () => {
    await assert.rejects(() => commitClutchTap({ ms: 4100, at: 1 }), /réseau coupé/);
    assert.equal(showAppAlertMock.mock.callCount(), 0);
    assert.equal(savedSession.taps.Alice, undefined);
  });
});

describe("Clutch : écran après un tap raté", () => {
  const src = readFileSync(join(__dirname, "../js/games/clutch.js"), "utf8");
  const session = readFileSync(join(__dirname, "../js/core/clutchSession.js"), "utf8");

  it("plus de fenêtre d'alerte dans l'envoi du tap", () => {
    const fn = session.slice(
      session.indexOf("export async function commitClutchTap"),
      session.indexOf("export function __resetClutchTapAttemptIdForTests")
    );
    assert.doesNotMatch(fn, /showAppAlert/);
  });

  it("temps écoulé : message dédié à la place de « Temps écoulé »", () => {
    assert.equal(CLUTCH_TAP_FAILED_LATE_LABEL, "Ton tap n’est pas parti à temps.");
    assert.match(
      src,
      /: tapFailed && !tapped && localWindowClosed\s*\?\s*CLUTCH_TAP_FAILED_LATE_LABEL\s*: localWindowClosed/
    );
  });
});
