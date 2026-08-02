/**
 * UX-CHAT-01 — annonce à l'entrée prep (commitPrepSessionLaunch), pas au play.
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
  buildGamePreparationChatMessage,
  announceGamePreparationInChat,
} from "../js/core/announceGameStartedInChat.js";
import { GAMES } from "../data/games.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mpLaunchSrc = readFileSync(join(__dirname, "../js/core/mpLaunch.js"), "utf8");
const announceSrc = readFileSync(
  join(__dirname, "../js/core/announceGameStartedInChat.js"),
  "utf8"
);
const restartSrc = readFileSync(join(__dirname, "../js/core/restartGame.js"), "utf8");
const pollStoreSrc = readFileSync(join(__dirname, "../js/core/lobbyPollStore.js"), "utf8");

describe("UX-CHAT-01 — titres + message prep (comportemental)", () => {
  it("résout Trivia Quiz depuis GAMES", () => {
    assert.equal(SESSION_GAME_ID_TO_TILE.trivia, "trivia-prep");
    assert.equal(catalogTitleForSessionGameId("trivia"), "Trivia Quiz");
    assert.equal(GAMES.find((g) => g.id === "trivia-prep").title, "Trivia Quiz");
  });

  it("formulation préparation (pas « partie commence »)", () => {
    assert.equal(
      buildGamePreparationChatMessage("trivia"),
      "🎮 L'hôte lance la préparation de Trivia Quiz."
    );
    assert.equal(
      buildGamePreparationChatMessage("hottake"),
      "🎮 L'hôte lance la préparation de HotTake."
    );
    assert.doesNotMatch(
      buildGamePreparationChatMessage("trivia"),
      /Une partie de .+ commence/
    );
  });

  it("fallback générique sans undefined", () => {
    const msg = buildGamePreparationChatMessage("nope");
    assert.equal(msg, "🎮 L'hôte lance la préparation d'un jeu.");
    assert.doesNotMatch(msg, /undefined|null|\[object/i);
  });
});

describe("UX-CHAT-01 — announceGamePreparationInChat (comportemental)", () => {
  it("échec addMessage : warning, pas de throw", async () => {
    const addMessage = mock.fn(async () => {
      throw new Error("chat down");
    });
    const warnings = [];
    const orig = console.warn;
    console.warn = (...a) => warnings.push(a);
    try {
      await announceGamePreparationInChat("trivia", { addMessage });
    } finally {
      console.warn = orig;
    }
    assert.equal(addMessage.mock.calls.length, 1);
    assert.equal(
      addMessage.mock.calls[0].arguments[0],
      "🎮 L'hôte lance la préparation de Trivia Quiz."
    );
    assert.ok(warnings.some((w) => w[0] === "[UX-CHAT-01] announce failed"));
  });

  it("succès : une écriture", async () => {
    const addMessage = mock.fn(async () => {});
    await announceGamePreparationInChat("dilemma", { addMessage });
    assert.equal(addMessage.mock.calls.length, 1);
  });
});

describe("UX-CHAT-01 — contrats source (point d'émission)", () => {
  it("annonce dans commitPrepSessionLaunch après startGameSession réussi", () => {
    assert.match(restartSrc, /fireGamePreparationChatAnnounce/);
    assert.match(restartSrc, /await startGameSession[\s\S]*?fireGamePreparationChatAnnounce\(gameId\)/);
    const fires = [...restartSrc.matchAll(/fireGamePreparationChatAnnounce\(gameId\);/g)];
    assert.equal(fires.length, 1);
  });

  it("aucune annonce dans launchGameWithSync (play)", () => {
    assert.doesNotMatch(mpLaunchSrc, /fireGameStartedChatAnnounce/);
    assert.doesNotMatch(mpLaunchSrc, /announceGamePreparationInChat/);
    assert.doesNotMatch(mpLaunchSrc, /announceGameStartedInChat/);
  });

  it("Recommencer réutilise launch*Prep → commitPrepSessionLaunch", () => {
    assert.match(restartSrc, /RESTART_HANDLERS/);
    assert.match(restartSrc, /trivia:\s*launchTriviaPrep/);
    assert.match(restartSrc, /commitPrepSessionLaunch/);
  });

  it("fermeture sondage n'annonce pas (annonce = prep host)", () => {
    assert.doesNotMatch(pollStoreSrc, /announceGamePreparationInChat/);
    assert.doesNotMatch(pollStoreSrc, /fireGamePreparationChatAnnounce/);
    assert.doesNotMatch(pollStoreSrc, /addLobbyMessage/);
  });

  it("documente absence de jeu sans prep + pas de double play", () => {
    assert.match(announceSrc, /sans écran prep/);
    assert.match(announceSrc, /Pas d'annonce au clic/);
  });
});
