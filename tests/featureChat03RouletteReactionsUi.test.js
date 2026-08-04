/**
 * FEATURE-CHAT-03 - wiring UI réactions (phase / disabled / handlers).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_ROULETTE_DURATION_MS,
  canAcceptChatRouletteReactions,
} from "../js/core/chatRandomGameLogic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function spinEvent(over = {}) {
  const start = 1_000_000;
  return {
    rouletteId: "r1",
    attemptId: "a1",
    phase: "spinning",
    selectedTileId: "hottake-prep",
    eligibleTileIds: ["hottake-prep", "consensus-prep"],
    drawCount: 1,
    createdAt: start,
    animationStartTimestamp: start,
    animationDurationMs: CHAT_ROULETTE_DURATION_MS,
    expiresAt: start + 120_000,
    reactionsByUid: {},
    ...over,
  };
}

describe("FEATURE-CHAT-03 - interactabilité réactions / phase", () => {
  it("1. phase result → réactions acceptées", () => {
    assert.equal(
      canAcceptChatRouletteReactions({ ...spinEvent(), phase: "result" }),
      true
    );
  });

  it("2. phase spinning (même après animation locale) → réactions refusées", () => {
    const ev = spinEvent();
    assert.equal(canAcceptChatRouletteReactions(ev), false);
  });

  it("3. UI réactions rendues seulement si phase result", () => {
    const uiSrc = readFileSync(
      join(__dirname, "../js/core/chatRandomGameUi.js"),
      "utf8"
    );
    assert.match(uiSrc, /phaseResult\s*\?\s*renderReactions/);
    assert.match(uiSrc, /ev\.phase === "result"/);
  });

  it("4–5. handler onReaction + onSpinAnimationComplete câblés", () => {
    const syncSrc = readFileSync(join(__dirname, "../js/core/chatRandomGame.js"), "utf8");
    assert.match(syncSrc, /onReaction:\s*\(reactionId\)/);
    assert.match(syncSrc, /onSpinAnimationComplete/);
    assert.match(syncSrc, /hostPublishSpinPhaseResult/);
  });

  it("6–7. invité et hôte - pas de garde isHost sur réactions", () => {
    const syncSrc = readFileSync(join(__dirname, "../js/core/chatRandomGame.js"), "utf8");
    assert.doesNotMatch(syncSrc, /isLobbyHost\(\)[\s\S]{0,80}onReaction/);
  });

  it("8. délégation click stable sur root", () => {
    const uiSrc = readFileSync(
      join(__dirname, "../js/core/chatRandomGameUi.js"),
      "utf8"
    );
    assert.match(uiSrc, /bindRootOnce\(root\)/);
    assert.match(uiSrc, /data-roulette-reaction/);
    assert.match(uiSrc, /handlers\?\.onReaction/);
  });

  it("9. couche --disabled si canReact false", () => {
    const css = readFileSync(join(__dirname, "../style.css"), "utf8");
    assert.match(css, /\.chat-roulette__reactions--disabled[\s\S]*pointer-events:none/);
  });

  it("10–12. optimisme avant RPC ; commit sans isHost", () => {
    const src = readFileSync(
      join(__dirname, "../js/core/chatRandomGameReaction.js"),
      "utf8"
    );
    assert.match(src, /presentChatRouletteEvent\(optimisticEv\)/);
    assert.match(src, /persistChatRouletteReactionRemote/);
  });

  it("fin animation → callback hôte (finishSpinIfCurrent)", () => {
    const uiSrc = readFileSync(
      join(__dirname, "../js/core/chatRandomGameUi.js"),
      "utf8"
    );
    assert.match(uiSrc, /finishSpinIfCurrent[\s\S]*onSpinAnimationComplete/);
  });
});

describe("FEATURE-CHAT-03 - bug QA repro corrigé via phase partagée", () => {
  it("spinning affiché localement n'active pas les réactions sans phase result", () => {
    const ev = spinEvent();
    assert.equal(ev.phase, "spinning");
    assert.equal(canAcceptChatRouletteReactions(ev), false);
  });
});
