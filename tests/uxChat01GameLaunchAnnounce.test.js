/**
 * UX-CHAT-01 — annonce chat au lancement.
 * Helper + contrats source ici ; chemins launchGameWithSync couverts aussi dans mpLaunchLaunch.test.js.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogTitleForSessionGameId,
  SESSION_GAME_ID_TO_TILE,
} from "../js/core/gameCatalogTitle.js";
import {
  buildGameStartedChatMessage,
  announceGameStartedInChat,
} from "../js/core/announceGameStartedInChat.js";
import { GAMES } from "../data/games.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mpLaunchSrc = readFileSync(join(__dirname, "../js/core/mpLaunch.js"), "utf8");
const announceSrc = readFileSync(
  join(__dirname, "../js/core/announceGameStartedInChat.js"),
  "utf8"
);
const restartSrc = readFileSync(join(__dirname, "../js/core/restartGame.js"), "utf8");
const gameSyncSrc = readFileSync(join(__dirname, "../js/core/gameSync.js"), "utf8");

describe("UX-CHAT-01 — titres catalogue (comportemental)", () => {
  it("résout Trivia Quiz depuis GAMES via mapping session", () => {
    assert.equal(SESSION_GAME_ID_TO_TILE.trivia, "trivia-prep");
    assert.equal(catalogTitleForSessionGameId("trivia"), "Trivia Quiz");
    const tile = GAMES.find((g) => g.id === "trivia-prep");
    assert.equal(tile.title, "Trivia Quiz");
  });

  it("message exact avec titre catalogue", () => {
    assert.equal(
      buildGameStartedChatMessage("trivia"),
      "🎮 Une partie de Trivia Quiz commence !"
    );
    assert.equal(
      buildGameStartedChatMessage("hottake"),
      "🎮 Une partie de HotTake commence !"
    );
    assert.equal(
      buildGameStartedChatMessage("dilemma"),
      "🎮 Une partie de Dilemma commence !"
    );
  });

  it("fallback générique sans undefined pour jeu inconnu", () => {
    assert.equal(catalogTitleForSessionGameId("nope"), null);
    const msg = buildGameStartedChatMessage("nope");
    assert.equal(msg, "🎮 Une nouvelle partie commence !");
    assert.doesNotMatch(msg, /undefined|null|\[object/i);
  });

  it("aucune map de libellés dans announce ; titres via catalogTitle", () => {
    assert.doesNotMatch(announceSrc, /trivia:\s*["']Trivia/);
    assert.match(announceSrc, /catalogTitleForSessionGameId/);
    assert.match(restartSrc, /catalogTitleForSessionGameId/);
    assert.match(gameSyncSrc, /from "\.\/gameCatalogTitle\.js"/);
  });
});

describe("UX-CHAT-01 — announceGameStartedInChat (comportemental)", () => {
  it("échec addMessage : warning, pas de throw", async () => {
    const addMessage = mock.fn(async () => {
      throw new Error("chat down");
    });
    const warnings = [];
    const orig = console.warn;
    console.warn = (...a) => warnings.push(a);
    try {
      await announceGameStartedInChat("trivia", { addMessage });
    } finally {
      console.warn = orig;
    }
    assert.equal(addMessage.mock.calls.length, 1);
    assert.equal(
      addMessage.mock.calls[0].arguments[0],
      "🎮 Une partie de Trivia Quiz commence !"
    );
    assert.ok(warnings.some((w) => w[0] === "[UX-CHAT-01] announce failed"));
  });

  it("succès : une écriture", async () => {
    const addMessage = mock.fn(async () => {});
    await announceGameStartedInChat("clutch", { addMessage });
    assert.equal(addMessage.mock.calls.length, 1);
    assert.equal(
      addMessage.mock.calls[0].arguments[0],
      "🎮 Une partie de Clutch commence !"
    );
  });
});

describe("UX-CHAT-01 — contrats source", () => {
  it("émission uniquement dans launchGameWithSync (succès + fallback)", () => {
    assert.match(mpLaunchSrc, /fireGameStartedChatAnnounce/);
    assert.match(mpLaunchSrc, /import\("\.\/announceGameStartedInChat\.js"\)/);
    const callSites = [
      ...mpLaunchSrc.matchAll(/fireGameStartedChatAnnounce\(gameId\);/g),
    ];
    assert.equal(callSites.length, 2, "une fois succès, une fois fallback");
  });

  it("pas d'annonce sur offline early-return (contrat source)", () => {
    const offlineBlock = mpLaunchSrc.slice(
      mpLaunchSrc.indexOf("if (!isGameSyncActive())"),
      mpLaunchSrc.indexOf("if (!isLobbyHost())")
    );
    assert.doesNotMatch(offlineBlock, /fireGameStartedChatAnnounce/);
  });

  it("notHost return avant annonce", () => {
    const hostBlock = mpLaunchSrc.slice(
      mpLaunchSrc.indexOf("if (!isLobbyHost())"),
      mpLaunchSrc.indexOf("if (localFirst)")
    );
    assert.match(hostBlock, /notHost/);
    assert.doesNotMatch(hostBlock, /fireGameStartedChatAnnounce/);
  });

  it("documente v1.1 replays startGameSession", () => {
    assert.match(mpLaunchSrc, /v1\.1/);
    assert.match(announceSrc, /startGameSession/);
    assert.match(announceSrc, /Trivia/);
  });

  it("hors scope : restartGame / setLobbyPlaying n'appellent pas announce", () => {
    assert.doesNotMatch(restartSrc, /announceGameStartedInChat/);
    const lobbySrc = readFileSync(join(__dirname, "../js/core/lobby.js"), "utf8");
    assert.doesNotMatch(lobbySrc, /announceGameStartedInChat/);
  });
});
