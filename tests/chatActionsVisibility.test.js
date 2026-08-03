/**
 * Régression FEATURE-CHAT-03 — visibilité actions chat (sondage + roulette).
 * Contrat : sous-conteneurs distincts ; blocking roulette ≠ masquage CTA ;
 * auto-close sheet = transition hub→prep, pas boucle sur écran courant.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_HUB_SCREENS,
  isChatHubScreen,
  shouldAutoCloseChatSheetOnScreen,
  shouldDismissChatSheetOnScreenTransition,
} from "../js/core/chatFabScreens.js";
import {
  canOfferPollCreate,
  localScreenAllowsPollCreate,
  remotePhaseAllowsPollCreate,
} from "../js/core/lobbyPollLogic.js";
import {
  localScreenAllowsChatRoulette,
  remotePhaseAllowsChatRoulette,
  isChatRouletteBlockingLaunch,
  buildChatRoulettePromptPayload,
  computeChatRouletteExpiresAt,
  CHAT_ROULETTE_DURATION_MS,
  CHAT_ROULETTE_MAX_REROLLS,
} from "../js/core/chatRandomGameLogic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HUB = ["game-select", "results", "leaderboard"];
const PREP = [
  "traitre-prep",
  "hottake-prep",
  "speedvote-prep",
  "consensus-prep",
];

function menuRow(screen = "game-select") {
  return { game_id: "menu", screen };
}

function rouletteEv(phase = "prompt") {
  const now = 1_000_000;
  return {
    rouletteId: "r1",
    attemptId: "a1",
    phase,
    selectedTileId: phase === "prompt" ? null : "hottake-prep",
    eligibleTileIds: ["hottake-prep", "consensus-prep"],
    createdAt: now,
    animationStartTimestamp: phase === "prompt" ? null : now,
    animationDurationMs: CHAT_ROULETTE_DURATION_MS,
    expiresAt: computeChatRouletteExpiresAt(now),
    rerollCount: 0,
    maxRerolls: CHAT_ROULETTE_MAX_REROLLS,
  };
}

/** Miroir du contrat canOfferChatRouletteCta (sans DOM / host). */
function canShowRouletteCta({ localScreen, sessionRow, lobbyGameId = "menu" }) {
  if (!localScreenAllowsChatRoulette(localScreen)) return false;
  return remotePhaseAllowsChatRoulette(sessionRow, lobbyGameId);
}

function canShowPollCreateCta({ localScreen, sessionRow, lobbyGameId = "menu", activePoll = null }) {
  return canOfferPollCreate({
    localScreen,
    sessionRow,
    lobbyGameId,
    activePoll,
  });
}

describe("chat actions — hub visibility matrix", () => {
  it("1. hub game-select : les deux actions visibles (create + roulette)", () => {
    const row = menuRow("game-select");
    assert.equal(canShowPollCreateCta({ localScreen: "game-select", sessionRow: row }), true);
    assert.equal(canShowRouletteCta({ localScreen: "game-select", sessionRow: row }), true);
  });

  it("2. hub : roulette show indépendant du rôle (enabled séparé)", () => {
    const orch = readFileSync(join(__dirname, "../js/core/chatRandomGame.js"), "utf8");
    assert.match(orch, /export function canOfferChatRouletteCta/);
    assert.match(orch, /export function isChatRouletteCtaEnabled/);
    // Visibilité ≠ blocking
    const start = orch.indexOf("export function canOfferChatRouletteCta");
    const end = orch.indexOf("export function isChatRouletteCtaEnabled");
    const body = orch.slice(start, end);
    assert.doesNotMatch(body, /isChatRouletteBlocking/);
  });

  it("3. results autorisé : les deux actions", () => {
    const row = menuRow("results");
    assert.equal(canShowPollCreateCta({ localScreen: "results", sessionRow: row }), true);
    assert.equal(canShowRouletteCta({ localScreen: "results", sessionRow: row }), true);
  });

  it("4. entrée game-prep : dismiss sheet (transition), CTA hub absentes en prep", () => {
    assert.equal(
      shouldDismissChatSheetOnScreenTransition("game-select", "traitre-prep"),
      true
    );
    assert.equal(canShowPollCreateCta({ localScreen: "traitre-prep", sessionRow: menuRow() }), false);
    assert.equal(canShowRouletteCta({ localScreen: "traitre-prep", sessionRow: menuRow() }), false);
  });

  it("5. retour hub : actions de nouveau offertes ; pas de dismiss", () => {
    assert.equal(
      shouldDismissChatSheetOnScreenTransition("traitre-prep", "game-select"),
      false
    );
    const row = menuRow("game-select");
    assert.equal(canShowPollCreateCta({ localScreen: "game-select", sessionRow: row }), true);
    assert.equal(canShowRouletteCta({ localScreen: "game-select", sessionRow: row }), true);
  });

  it("6. roulette absente : sondage visible", () => {
    const row = menuRow();
    assert.equal(canShowPollCreateCta({ localScreen: "game-select", sessionRow: row }), true);
  });

  for (const phase of ["prompt", "spinning", "result"]) {
    it(`7-9. roulette ${phase} : sondage toujours visible ; blocking ≠ hide poll`, () => {
      const row = menuRow();
      const ev = rouletteEv(phase);
      assert.equal(
        isChatRouletteBlockingLaunch({
          chatRoulette: ev,
          nowWallClock: 1_000_000,
          sessionUpdatedAtMs: 1_000_000,
          nowMonotonic: 0,
          localObservation: {
            activityKey: `${ev.rouletteId}|${ev.attemptId}`,
            firstSeenMono: 0,
            serverUpdatedAtMs: 1_000_000,
          },
        }),
        true
      );
      assert.equal(canShowPollCreateCta({ localScreen: "game-select", sessionRow: row }), true);
      assert.equal(canShowRouletteCta({ localScreen: "game-select", sessionRow: row }), true);
    });
  }

  it("10. roulette expirée / cancelled : les deux actions visibles", () => {
    const row = menuRow();
    const ev = rouletteEv("cancelled");
    assert.equal(
      isChatRouletteBlockingLaunch({ chatRoulette: ev, nowWallClock: 1_000_000 }),
      false
    );
    assert.equal(canShowPollCreateCta({ localScreen: "game-select", sessionRow: row }), true);
    assert.equal(canShowRouletteCta({ localScreen: "game-select", sessionRow: row }), true);
  });

  it("11. sondage ouvert : roulette toujours visible (create CTA masquée seule)", () => {
    const row = menuRow();
    assert.equal(
      canShowPollCreateCta({
        localScreen: "game-select",
        sessionRow: row,
        activePoll: { id: "p1", status: "open" },
      }),
      false
    );
    assert.equal(canShowRouletteCta({ localScreen: "game-select", sessionRow: row }), true);
  });
});

describe("chat actions — DOM isolation & cleanup contracts", () => {
  it("12. chaque renderer ne touche que son sous-conteneur", () => {
    const pollUi = readFileSync(
      join(__dirname, "../js/core/lobbyPollSheetUi.js"),
      "utf8"
    );
    const randomUi = readFileSync(
      join(__dirname, "../js/core/chatRandomGame.js"),
      "utf8"
    );
    assert.match(pollUi, /#chat-sheet-poll/);
    assert.match(randomUi, /#chat-sheet-random/);
    assert.match(pollUi, /Ne touche que son sous-conteneur|jamais #chat-sheet-random/);
    assert.match(randomUi, /Ne remplace jamais le DOM sondage|#chat-sheet-poll/);
    // renderLobbyPollSheet / renderChatRandomGameCta n'écrivent que rootEl passé
    assert.match(pollUi, /rootEl\.innerHTML/);
    assert.match(randomUi, /rootEl\.innerHTML/);
  });

  it("13. sheet HTML : actions wrapper + ordre roulette puis sondage", () => {
    const fab = readFileSync(join(__dirname, "../js/core/feedbackUi.js"), "utf8");
    const actionsIdx = fab.indexOf('id="chat-sheet-actions"');
    const randomIdx = fab.indexOf('id="chat-sheet-random"');
    const pollIdx = fab.indexOf('id="chat-sheet-poll"');
    assert.ok(actionsIdx > 0);
    assert.ok(randomIdx > actionsIdx);
    assert.ok(pollIdx > randomIdx);
  });

  it("14. enabled/disabled recalculé via isChatRouletteCtaEnabled (pas hide parent)", () => {
    const orch = readFileSync(join(__dirname, "../js/core/chatRandomGame.js"), "utf8");
    const renderStart = orch.indexOf("export function renderChatRandomGameCta");
    const render = orch.slice(renderStart, renderStart + 900);
    assert.match(render, /isChatRouletteCtaEnabled/);
    assert.match(render, /disabled/);
    assert.match(render, /canOfferChatRouletteCta/);
  });

  it("15. cleanup game-prep = edge transition ; reste sur hub ne ferme pas", () => {
    assert.equal(shouldDismissChatSheetOnScreenTransition("game-select", "game-select"), false);
    assert.equal(shouldDismissChatSheetOnScreenTransition("results", "leaderboard"), false);
    assert.equal(shouldDismissChatSheetOnScreenTransition("game-select", "hottake-prep"), true);
    assert.equal(shouldDismissChatSheetOnScreenTransition("hottake-prep", "hottake-prep"), false);
    assert.equal(shouldDismissChatSheetOnScreenTransition("hottake-prep", "traitre-prep"), false);
    assert.equal(shouldDismissChatSheetOnScreenTransition(null, "traitre-prep"), true);

    const fab = readFileSync(join(__dirname, "../js/core/feedbackUi.js"), "utf8");
    assert.match(fab, /shouldDismissChatSheetOnScreenTransition/);
    assert.doesNotMatch(
      fab,
      /sheetOpen && \(!show \|\| shouldAutoCloseChatSheetOnScreen\(screen\)\)/
    );
  });

  it("phases roulette sur hub ne déclenchent pas dismiss sheet", () => {
    for (const s of HUB) {
      assert.equal(isChatHubScreen(s), true);
      assert.equal(shouldAutoCloseChatSheetOnScreen(s), false);
      assert.equal(CHAT_HUB_SCREENS.has(s), true);
    }
    for (const s of PREP) {
      assert.equal(shouldAutoCloseChatSheetOnScreen(s), true);
    }
  });

  it("remote phase menu vs screen : confusion game_id/menu documentée", () => {
    assert.equal(remotePhaseAllowsPollCreate({ game_id: "hottake", screen: "game-select" }), false);
    assert.equal(remotePhaseAllowsChatRoulette({ game_id: "hottake", screen: "game-select" }), false);
    assert.equal(remotePhaseAllowsPollCreate({ game_id: "menu", screen: "hottake-prep" }), false);
    assert.equal(remotePhaseAllowsPollCreate(menuRow("game-select")), true);
    assert.equal(localScreenAllowsPollCreate("game-select"), true);
    assert.equal(localScreenAllowsChatRoulette("game-select"), true);
  });

  it("publishRoulette / clear préservent menu seulement si session menu", () => {
    const orch = readFileSync(join(__dirname, "../js/core/chatRandomGame.js"), "utf8");
    assert.match(orch, /hubPatchOptionsForRoulette/);
    assert.match(orch, /gid !== "menu"/);
  });

  it("buildChatRoulettePromptPayload smoke", () => {
    const p = buildChatRoulettePromptPayload([{ id: "hottake-prep" }], 1000);
    assert.equal(p.phase, "prompt");
  });
});
