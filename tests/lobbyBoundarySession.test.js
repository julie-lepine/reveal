/**
 * ARCH/BUG - Résidu de partie après changement de lobby.
 * Contrats lobbyBoundary + gardes consommateurs (sans DOM).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  canApplyRemoteSessionRow,
  getLastGameScopeKey,
  isLastGameInCurrentScope,
  isSessionRowForLobby,
  resolveSessionRestoreOutcome,
  shouldClearCachedSessionForLobbyBoundary,
  shouldExposeCachedSession,
} from "../js/core/lobbyBoundary.js";
import {
  getLastGame,
  getState,
  saveStatePatch,
  setLastGame,
} from "../js/core/state.js";
import {
  bumpLobbyRuntimeGeneration,
  captureLobbyRuntimeEpoch,
  isLobbyRuntimeEpochCurrent,
  shouldApplyLobbyRuntimeResult,
  __resetLobbyRuntimeGenerationForTests,
} from "../js/core/lobbyRuntime.js";

const ROW_A_GUESSLIE = {
  lobby_id: "lobby-a",
  game_id: "guesslie",
  screen: "guesslie-menu",
  state: { guessLie: { phase: "prep" } },
};

const ROW_B_HOTTTAKE = {
  lobby_id: "lobby-b",
  game_id: "hottake",
  screen: "hottake-prep",
  state: { hotTake: {} },
};

/** Miroir garde getResumableSessionScreen (prep/play, pas post-partie). */
function getResumableSessionScreenGuard(row, currentLobbyId) {
  if (!row || !currentLobbyId) return null;
  if (!isSessionRowForLobby(row, currentLobbyId)) return null;
  if (row.screen === "results" || row.screen === "leaderboard") return null;
  if (row.screen === "guesslie-menu" || row.screen === "hottake-prep") return row.screen;
  return null;
}

/** Miroir garde routeToActiveGameIfNeeded (refus foreign row). */
function routeToActiveGameAllowed(row, currentLobbyId) {
  if (!row) return false;
  return isSessionRowForLobby(row, currentLobbyId);
}

/** Miroir resolveLastGameForRestart (session post-partie + lastGame scope). */
function resolveLastGameForRestartGuard({ lastGame, row, currentLobbyId, syncActive }) {
  const scopedLast =
    lastGame && isLastGameInCurrentScope(lastGame, currentLobbyId) ? lastGame : null;
  if (!syncActive) return scopedLast;
  if (!row || !isSessionRowForLobby(row, currentLobbyId)) return scopedLast;
  if (row.screen !== "results" && row.screen !== "leaderboard") return scopedLast;
  if (row.game_id === "guesslie") {
    return { gameId: "guesslie", title: "Guess The Lie" };
  }
  return scopedLast;
}

describe("lobbyBoundary - contrats purs", () => {
  it("isSessionRowForLobby exige lobby_id identique", () => {
    assert.equal(isSessionRowForLobby(ROW_A_GUESSLIE, "lobby-a"), true);
    assert.equal(isSessionRowForLobby(ROW_A_GUESSLIE, "lobby-b"), false);
    assert.equal(isSessionRowForLobby(null, "lobby-a"), false);
  });

  it("shouldExposeCachedSession refuse une row d'un autre lobby", () => {
    assert.equal(shouldExposeCachedSession(ROW_A_GUESSLIE, "lobby-a"), true);
    assert.equal(shouldExposeCachedSession(ROW_A_GUESSLIE, "lobby-b"), false);
    assert.equal(shouldExposeCachedSession(ROW_A_GUESSLIE, null), false);
  });

  it("canApplyRemoteSessionRow : foreign row rejetée ; null seulement si cache même lobby", () => {
    assert.equal(canApplyRemoteSessionRow(ROW_A_GUESSLIE, "lobby-b", ROW_A_GUESSLIE), false);
    assert.equal(canApplyRemoteSessionRow(ROW_B_HOTTTAKE, "lobby-b", ROW_A_GUESSLIE), true);
    assert.equal(canApplyRemoteSessionRow(null, "lobby-b", ROW_A_GUESSLIE), false);
    assert.equal(canApplyRemoteSessionRow(null, "lobby-a", ROW_A_GUESSLIE), true);
    assert.equal(canApplyRemoteSessionRow(null, "lobby-b", null), true);
  });

  it("shouldClearCachedSessionForLobbyBoundary sur frontière vers B", () => {
    assert.equal(shouldClearCachedSessionForLobbyBoundary(ROW_A_GUESSLIE, "lobby-b"), true);
    assert.equal(shouldClearCachedSessionForLobbyBoundary(ROW_A_GUESSLIE, "lobby-a"), false);
    assert.equal(shouldClearCachedSessionForLobbyBoundary(null, "lobby-b"), false);
  });
});

describe("Cas 1 - cache lobby A, création lobby B sans session", () => {
  it("aucune reprise / routage / lastGame hérité", () => {
    const currentLobbyId = "lobby-b";
    const cachedRow = ROW_A_GUESSLIE;
    const lastGame = { gameId: "guesslie", scopeKey: "lobby-a" };

    assert.equal(shouldExposeCachedSession(cachedRow, currentLobbyId), false);
    assert.equal(getResumableSessionScreenGuard(cachedRow, currentLobbyId), null);
    assert.equal(routeToActiveGameAllowed(cachedRow, currentLobbyId), false);
    assert.equal(
      resolveLastGameForRestartGuard({
        lastGame,
        row: cachedRow,
        currentLobbyId,
        syncActive: true,
      })?.gameId,
      undefined
    );
    assert.equal(isLastGameInCurrentScope(lastGame, currentLobbyId), false);
  });
});

describe("Cas 2 - cache lobby A, lobby B possède une session", () => {
  it("seule la session de B est exploitable après activation", () => {
    const currentLobbyId = "lobby-b";
    const staleA = ROW_A_GUESSLIE;
    const sessionB = ROW_B_HOTTTAKE;

    assert.equal(shouldExposeCachedSession(staleA, currentLobbyId), false);
    assert.equal(shouldExposeCachedSession(sessionB, currentLobbyId), true);
    assert.equal(getResumableSessionScreenGuard(sessionB, currentLobbyId), "hottake-prep");
    assert.equal(getResumableSessionScreenGuard(staleA, currentLobbyId), null);
    assert.equal(canApplyRemoteSessionRow(sessionB, currentLobbyId, staleA), true);
    assert.equal(canApplyRemoteSessionRow(staleA, currentLobbyId, staleA), false);
  });
});

describe("Cas 3 - erreur réseau pendant hydratation de B", () => {
  it("resolveSessionRestoreOutcome : erreurs seules ≠ absence confirmée", () => {
    const allErrors = resolveSessionRestoreOutcome([
      { status: "error" },
      { status: "error" },
    ]);
    assert.equal(allErrors.status, "error");

    const mixed = resolveSessionRestoreOutcome([
      { status: "error" },
      { status: "none" },
    ]);
    assert.equal(mixed.status, "none");

    const foundWins = resolveSessionRestoreOutcome([
      { status: "error" },
      { status: "none" },
      { status: "found", row: ROW_B_HOTTTAKE },
    ]);
    assert.equal(foundWins.status, "found");
  });

  it("sur erreur indéterminée, session A non exposée comme lobby B", () => {
    const currentLobbyId = "lobby-b";
    const cachedRow = ROW_A_GUESSLIE;
    assert.equal(shouldExposeCachedSession(cachedRow, currentLobbyId), false);
    assert.equal(getResumableSessionScreenGuard(cachedRow, currentLobbyId), null);
  });
});

describe("Cas 4 - même lobby, remount / reconnexion", () => {
  it("session du lobby courant reste exploitable", () => {
    const currentLobbyId = "lobby-a";
    assert.equal(shouldExposeCachedSession(ROW_A_GUESSLIE, currentLobbyId), true);
    assert.equal(
      getResumableSessionScreenGuard(ROW_A_GUESSLIE, currentLobbyId),
      "guesslie-menu"
    );
    assert.equal(
      resolveSessionRestoreOutcome([{ status: "found", row: ROW_A_GUESSLIE }]).status,
      "found"
    );
  });
});

describe("Cas 5 - Résultats puis nouvelle soirée (lastGame scope)", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("lastGame de A invisible dans B ; rejouer dans B recrée lastGame", () => {
    saveStatePatch({
      lobby: { id: "lobby-a", code: "AAAA" },
      lobbyCode: "AAAA",
      inLobby: true,
    });
    setLastGame({ gameId: "guesslie", title: "Guess The Lie" });
    assert.equal(getLastGame()?.gameId, "guesslie");

    saveStatePatch({
      lobby: { id: "lobby-b", code: "BBBB" },
      lobbyCode: "BBBB",
      inLobby: true,
    });
    assert.equal(getLastGame(), null);

    setLastGame({ gameId: "hottake", title: "Hot Take" });
    assert.equal(getLastGame()?.gameId, "hottake");
    assert.equal(getLastGame()?.scopeKey, "lobby-b");
  });

  it("legacy lastGame sans scopeKey rejeté dans tout lobby", () => {
    saveStatePatch({
      lobby: { id: "lobby-b", code: "BBBB" },
      lobbyCode: "BBBB",
      inLobby: true,
      lastGame: { gameId: "guesslie", at: Date.now() },
    });
    assert.equal(getLastGame(), null);
  });
});

describe("Cas 6 - teardown canonique (composants)", () => {
  it("frontière vers B invalide cache A", () => {
    assert.equal(shouldClearCachedSessionForLobbyBoundary(ROW_A_GUESSLIE, "lobby-b"), true);
  });

  it("getLastGameScopeKey : id Supabase prioritaire sur code offline", () => {
    assert.equal(getLastGameScopeKey({ id: "uuid-1", code: "ABCD" }), "uuid-1");
    assert.equal(getLastGameScopeKey({ code: "ABCD" }, "ABCD"), "ABCD");
  });
});

describe("Cas 7 - gardes consommateurs refusent foreign lobby_id", () => {
  const foreign = ROW_A_GUESSLIE;
  const currentLobbyId = "lobby-b";

  it("reprise", () => {
    assert.equal(getResumableSessionScreenGuard(foreign, currentLobbyId), null);
  });

  it("routage actif", () => {
    assert.equal(routeToActiveGameAllowed(foreign, currentLobbyId), false);
  });

  it("résolution restart", () => {
    const resolved = resolveLastGameForRestartGuard({
      lastGame: { gameId: "guesslie", scopeKey: "lobby-a" },
      row: foreign,
      currentLobbyId,
      syncActive: true,
    });
    assert.equal(resolved?.gameId, undefined);
  });

  it("applyRemoteSession foreign row", () => {
    assert.equal(canApplyRemoteSessionRow(foreign, currentLobbyId, foreign), false);
  });
});

describe("Hydratation confirmée sans session (none)", () => {
  it("outcome none après retries sans found", () => {
    const outcome = resolveSessionRestoreOutcome([
      { status: "error" },
      { status: "none" },
      { status: "none" },
    ]);
    assert.equal(outcome.status, "none");
  });
});

describe("Génération runtime - callbacks tardives", () => {
  beforeEach(() => __resetLobbyRuntimeGenerationForTests());
  afterEach(() => __resetLobbyRuntimeGenerationForTests());

  it("callback de A rejetée après bump de transition vers B", () => {
    const epochA = captureLobbyRuntimeEpoch("lobby-a");
    bumpLobbyRuntimeGeneration();
    assert.equal(isLobbyRuntimeEpochCurrent(epochA), false);
    assert.equal(
      shouldApplyLobbyRuntimeResult(epochA, "lobby-a", "lobby-a"),
      false
    );
  });

  it("callback de A rejetée même si state indique encore A", () => {
    const epochA = captureLobbyRuntimeEpoch("lobby-a");
    bumpLobbyRuntimeGeneration();
    assert.equal(
      shouldApplyLobbyRuntimeResult(epochA, "lobby-a", "lobby-a"),
      false
    );
  });

  it("callback de B acceptée après activation si génération courante", () => {
    const epochB = captureLobbyRuntimeEpoch("lobby-b");
    assert.equal(
      shouldApplyLobbyRuntimeResult(epochB, "lobby-b", "lobby-b"),
      true
    );
  });

  it("callback lobby_id foreign rejetée même si génération courante", () => {
    const epoch = captureLobbyRuntimeEpoch("lobby-b");
    assert.equal(
      shouldApplyLobbyRuntimeResult(epoch, "lobby-a", "lobby-b"),
      false
    );
  });
});

describe("ARCH-01B - getLastGameScopeKey sans localInstanceId", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("id Supabase prioritaire ; sinon code ; localInstanceId ignoré", () => {
    assert.equal(getLastGameScopeKey({ id: "uuid-1", code: "ABCD" }), "uuid-1");
    assert.equal(getLastGameScopeKey({ code: "ABCD" }, "ABCD"), "ABCD");
    assert.equal(
      getLastGameScopeKey({ code: "DEMO", localInstanceId: "offline-x" }),
      "DEMO"
    );
  });

  it("changement de lobby.id invalide lastGame même si code inchangé", () => {
    const code = "SAME01";
    saveStatePatch({
      lobby: { id: "lobby-a", code },
      lobbyCode: code,
      inLobby: true,
    });
    setLastGame({ gameId: "guesslie", title: "Guess The Lie" });
    assert.equal(getLastGame()?.gameId, "guesslie");

    saveStatePatch({
      lobby: { id: "lobby-b", code },
      lobbyCode: code,
      inLobby: true,
    });
    assert.equal(getLastGame(), null);
  });
});

describe("Join échoue depuis A - contrat rollback (miroir)", () => {
  it("snapshot préserve lastGame scope de A", () => {
    const lastGame = {
      gameId: "guesslie",
      scopeKey: "lobby-a",
      at: Date.now(),
    };
    const patch = { lobby: { id: "lobby-a" }, lastGame, inLobby: true };
    const scopeAfterRollback = getLastGameScopeKey(patch.lobby, null);
    assert.equal(isLastGameInCurrentScope(lastGame, scopeAfterRollback), true);
  });
});
