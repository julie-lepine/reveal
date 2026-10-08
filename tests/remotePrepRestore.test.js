/**
 * Réhydratation locale après sortie invité : signature distante identique
 * ne signifie pas que le local prépa est déjà la partie active.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isNewTraitreGame } from "../js/core/sessionMerge.js";
import {
  remoteActiveOverLocalPrep,
  shouldPersistAppliedRemotePatch,
} from "../js/core/gameSync.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MATCH_A = "11111111-1111-4111-8111-111111111111";
const MATCH_B = "22222222-2222-4222-8222-222222222222";

const idle = {
  traitreGame: false,
  consensusGame: false,
  clutchGame: false,
};

function persist(overrides) {
  return shouldPersistAppliedRemotePatch({
    hasPatch: true,
    sigUnchanged: true,
    playChanged: false,
    localStarted: idle,
    patch: {},
    ...overrides,
  });
}

describe("persistance après reset local", () => {
  it("signature identique, play inchangé, local prépa, fusion active → écrire", () => {
    assert.equal(
      persist({
        patch: { traitreGame: { lobbyStarted: true, matchId: MATCH_A, phase: "speak" } },
      }),
      true
    );
  });

  it("local déjà en partie et fusion active, signature identique → ne pas écrire", () => {
    assert.equal(
      persist({
        localStarted: { ...idle, traitreGame: true },
        patch: { traitreGame: { lobbyStarted: true, matchId: MATCH_A, phase: "speak" } },
      }),
      false
    );
  });

  it("local prépa et fusion inactive → la nouvelle règle n'écrit pas", () => {
    assert.equal(
      persist({
        patch: { traitreGame: { lobbyStarted: false, phase: null } },
      }),
      false
    );
  });

  it("Consensus et Clutch suivent la même règle, Guess the Lie non", () => {
    assert.equal(
      persist({ patch: { consensusGame: { lobbyStarted: true } } }),
      true
    );
    assert.equal(
      persist({ patch: { clutchGame: { lobbyStarted: true } } }),
      true
    );
    assert.equal(
      remoteActiveOverLocalPrep(idle, { guessLie: { lobbyComplete: true } }),
      false
    );
  });

  it("un jeu absent du patch ne force pas l'écriture", () => {
    assert.equal(remoteActiveOverLocalPrep(idle, { hotTakeGame: { lobbyStarted: true } }), false);
  });

  it("signature différente ou playChanged écrit comme avant", () => {
    assert.equal(persist({ sigUnchanged: false, patch: { traitreGame: { lobbyStarted: false } } }), true);
    assert.equal(
      persist({
        playChanged: true,
        localStarted: { ...idle, traitreGame: true },
        patch: { traitreGame: { lobbyStarted: true } },
      }),
      true
    );
  });

  it("patch vide n'écrit pas", () => {
    assert.equal(persist({ hasPatch: false }), false);
  });
});

describe("non-régression manche et signature", () => {
  it("même matchId n'est pas une nouvelle partie, un autre matchId l'est", () => {
    const cur = { matchId: MATCH_A, lobbyStarted: true, phase: "speak" };
    assert.equal(isNewTraitreGame(cur, { matchId: MATCH_A, lobbyStarted: true, phase: "vote" }), false);
    assert.equal(isNewTraitreGame(cur, { matchId: MATCH_B, lobbyStarted: true, phase: "deal" }), true);
    assert.equal(isNewTraitreGame(cur, null), false);
  });

  it("le garde updated_at et le retour sans navigation restent en place", () => {
    const src = readFileSync(join(ROOT, "js/core/gameSync.js"), "utf8");
    const older = src.slice(
      src.indexOf("function isOlderSessionRow"),
      src.indexOf("export function isGameSyncActive")
    );
    assert.match(older, /return incoming < current/);
    assert.match(src, /localLobbyStartedBeforeMerge/);
    assert.match(src, /shouldPersistAppliedRemotePatch\(\{/);
    const saveAt = src.indexOf("shouldPersistAppliedRemotePatch({");
    const returnAt = src.indexOf("if (sigUnchanged && !playChanged)", saveAt);
    assert.ok(saveAt > 0 && returnAt > saveAt);
  });
});
