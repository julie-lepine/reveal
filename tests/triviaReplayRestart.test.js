/**
 * BUG-TRIVIA-01C — sécurisation replay / change-thème via startGameSession.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const triviaSrc = readFileSync(join(ROOT, "js/games/trivia.js"), "utf8");
const sessionSrc = readFileSync(join(ROOT, "js/core/triviaSession.js"), "utf8");

describe("trivia replay restart — contrats source 01C", () => {
  it("helper startTriviaRemoteRestart entoure startGameSession d'un try/catch", () => {
    assert.match(triviaSrc, /async function startTriviaRemoteRestart/);
    const start = triviaSrc.indexOf("async function startTriviaRemoteRestart");
    const end = triviaSrc.indexOf("async function openTriviaSetup", start);
    const block = triviaSrc.slice(start, end);
    assert.match(block, /try\s*\{/);
    assert.match(block, /await startGameSession\(/);
    assert.match(block, /catch\s*\(/);
    assert.match(block, /Impossible de relancer Trivia pour le moment/);
    assert.match(block, /showAppAlert/);
    assert.match(block, /console\.warn/);
  });

  it("replayTrivia et openTriviaSetup passent par le helper + verrou", () => {
    assert.match(triviaSrc, /replayLaunchLock/);
    assert.match(triviaSrc, /createActionLock/);
    const replayStart = triviaSrc.indexOf("async function replayTrivia");
    const replayEnd = triviaSrc.indexOf("async function finishTriviaGame", replayStart);
    const replayBlock = triviaSrc.slice(replayStart, replayEnd);
    assert.match(replayBlock, /replayLaunchLock\.run/);
    assert.match(replayBlock, /startTriviaRemoteRestart/);
    assert.match(replayBlock, /persistDeck:\s*!mp/);

    const setupStart = triviaSrc.indexOf("async function openTriviaSetup");
    const setupEnd = triviaSrc.indexOf("async function replayTrivia", setupStart);
    const setupBlock = triviaSrc.slice(setupStart, setupEnd);
    assert.match(setupBlock, /replayLaunchLock\.run/);
    assert.match(setupBlock, /startTriviaRemoteRestart\("trivia-prep"/);
  });

  it("aucun await startGameSession nu hors du helper dans trivia.js", () => {
    const withoutHelper = triviaSrc.replace(
      /async function startTriviaRemoteRestart[\s\S]*?^  async function openTriviaSetup/m,
      "async function openTriviaSetup"
    );
    assert.equal(
      /await startGameSession\(/.test(withoutHelper),
      false,
      "startGameSession ne doit être await que dans startTriviaRemoteRestart"
    );
  });

  it("createStartedTriviaSession accepte persistDeck pour éviter patch local anticipé", () => {
    assert.match(sessionSrc, /persistDeck\s*=\s*true/);
    assert.match(sessionSrc, /buildTriviaDeck\(replaySession,\s*\{\s*persist:\s*persistDeck\s*\}/);
  });

  it("actions podium replay / change-theme appellent les handlers sécurisés", () => {
    assert.match(triviaSrc, /action === "replay"[\s\S]*?await replayTrivia\(\)/);
    assert.match(
      triviaSrc,
      /action === "change-theme"[\s\S]*?await openTriviaSetup\(trivia\.buildReplaySession/
    );
  });

  it("markTriviaLobbyStarted garde le défaut persistDeck (premier lancement inchangé)", () => {
    const start = sessionSrc.indexOf("export async function markTriviaLobbyStarted");
    const end = sessionSrc.indexOf("export async function startTriviaQuestion", start);
    const block = sessionSrc.slice(start, end);
    assert.match(block, /createStartedTriviaSession\(\)/);
    assert.equal(
      /persistDeck:\s*false/.test(block),
      false,
      "markTriviaLobbyStarted ne doit pas forcer persistDeck:false"
    );
  });

  it("launchTriviaPrep n'utilise pas createStartedTriviaSession", () => {
    const restartSrc = readFileSync(join(ROOT, "js/core/restartGame.js"), "utf8");
    const start = restartSrc.indexOf("export async function launchTriviaPrep");
    const end = restartSrc.indexOf("export async function launchTruthMeterPrep", start);
    const block = restartSrc.slice(start, end);
    assert.match(block, /defaultTriviaPrepSession/);
    assert.equal(block.includes("createStartedTriviaSession"), false);
    assert.equal(block.includes("persistDeck"), false);
  });

  it("seul replayTrivia MP passe persistDeck:false", () => {
    assert.equal((triviaSrc.match(/persistDeck:\s*!mp/g) || []).length, 1);
    assert.equal((triviaSrc.match(/persistDeck:\s*false/g) || []).length, 0);
  });
});
