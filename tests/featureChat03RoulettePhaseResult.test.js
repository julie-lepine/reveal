/**
 * FEATURE-CHAT-03 - transition partagée spinning → result (hôte).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_ROULETTE_DURATION_MS,
  canAcceptChatRouletteReactions,
  isChatRoulettePhaseResultPatch,
  mergeChatRoulettePhaseResultPatch,
  shouldPublishChatRoulettePhaseResult,
  shouldDeferChatRouletteResultForLocalSpin,
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

describe("FEATURE-CHAT-03 - phase result partagée", () => {
  it("1. merge patch phase result depuis spinning", () => {
    const cur = spinEvent();
    const merged = mergeChatRoulettePhaseResultPatch(cur, { phase: "result" });
    assert.equal(merged.phase, "result");
    assert.equal(merged.attemptId, "a1");
    assert.equal(merged.selectedTileId, "hottake-prep");
  });

  it("2. patch ciblé détecté", () => {
    assert.equal(isChatRoulettePhaseResultPatch({ phase: "result" }), true);
    assert.equal(
      isChatRoulettePhaseResultPatch({ phase: "result", attemptId: "x" }),
      false
    );
  });

  it("3. callback attempt B ignore attempt A (stale_id)", () => {
    const cur = spinEvent({ attemptId: "a2" });
    const gate = shouldPublishChatRoulettePhaseResult(cur, {
      rouletteId: "r1",
      attemptId: "a1",
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "stale_id");
  });

  it("4. double publish → already_result noop", () => {
    const cur = spinEvent({ phase: "result" });
    const gate = shouldPublishChatRoulettePhaseResult(cur, {
      rouletteId: "r1",
      attemptId: "a1",
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.noop, true);
    assert.equal(
      mergeChatRoulettePhaseResultPatch(cur, { phase: "result" }).phase,
      "result"
    );
  });

  it("5. clear / wrong phase → no merge", () => {
    const prompt = spinEvent({ phase: "prompt", selectedTileId: null });
    assert.equal(
      mergeChatRoulettePhaseResultPatch(prompt, { phase: "result" }).phase,
      "prompt"
    );
  });

  it("6. phase déjà result → idempotent", () => {
    const cur = spinEvent({ phase: "result" });
    const gate = shouldPublishChatRoulettePhaseResult(cur, {
      rouletteId: "r1",
      attemptId: "a1",
    });
    assert.equal(gate.noop, true);
  });

  it("7. UI spinning → réactions inactives (strict result)", () => {
    const after = 1_000_000 + CHAT_ROULETTE_DURATION_MS + 50;
    assert.equal(canAcceptChatRouletteReactions(spinEvent(), after), false);
  });

  it("8. UI result → réactions actives", () => {
    assert.equal(
      canAcceptChatRouletteReactions(spinEvent({ phase: "result" })),
      true
    );
  });

  it("9–10. SQL strict result only", () => {
    const sql = readFileSync(
      join(__dirname, "../supabase/feature-chat-03-roulette-reactions.sql"),
      "utf8"
    );
    assert.match(sql, /v_phase is distinct from 'result'/);
    assert.doesNotMatch(sql, /animationStartTimestamp/);
    assert.doesNotMatch(sql, /clock_timestamp/);
  });

  it("11. horloge hôte n'influence plus SQL", () => {
    const sql = readFileSync(
      join(__dirname, "../supabase/feature-chat-03-roulette-reactions.sql"),
      "utf8"
    );
    assert.doesNotMatch(sql, /animationDurationMs/);
  });

  it("12–14. wiring hôte fin animation + retry", () => {
    const uiSrc = readFileSync(
      join(__dirname, "../js/core/chatRandomGameUi.js"),
      "utf8"
    );
    const syncSrc = readFileSync(
      join(__dirname, "../js/core/chatRandomGame.js"),
      "utf8"
    );
    const gsSrc = readFileSync(join(__dirname, "../js/core/gameSync.js"), "utf8");
    assert.match(uiSrc, /onSpinAnimationComplete/);
    assert.match(uiSrc, /finishSpinIfCurrent/);
    assert.match(syncSrc, /hostPublishSpinPhaseResult/);
    assert.match(syncSrc, /onSpinAnimationComplete/);
    assert.match(syncSrc, /resultPhasePublishLock/);
    assert.match(syncSrc, /tryIdx === 0/);
    assert.match(gsSrc, /mergeChatRoulettePhaseResultPatch/);
  });

  it("15–16. UI réactions seulement si phase result ; launch inchangé", () => {
    const uiSrc = readFileSync(
      join(__dirname, "../js/core/chatRandomGameUi.js"),
      "utf8"
    );
    const restartSrc = readFileSync(
      join(__dirname, "../js/core/restartGame.js"),
      "utf8"
    );
    assert.match(uiSrc, /phaseResult/);
    assert.match(uiSrc, /phaseResult\s*\?\s*renderReactions/);
    assert.match(restartSrc, /assertNoActiveChatRoulette/);
  });

  it("rouleau local : pas de seek timestamp hôte / result distant ne coupe pas", () => {
    const uiSrc = readFileSync(
      join(__dirname, "../js/core/chatRandomGameUi.js"),
      "utf8"
    );
    assert.match(uiSrc, /chatRouletteLocalSpinProgress/);
    assert.match(uiSrc, /shouldDeferChatRouletteResultForLocalSpin/);
    assert.match(uiSrc, /const start = Date\.now\(\)/);
    assert.doesNotMatch(uiSrc, /chatRouletteShouldShowResult/);
    assert.doesNotMatch(
      uiSrc,
      /const start = ev\.animationStartTimestamp/
    );
  });

  it("result distant même attempt : on laisse finir le spin local", () => {
    const spin = { rouletteId: "r1", attemptId: "a1" };
    assert.equal(
      shouldDeferChatRouletteResultForLocalSpin(
        { phase: "result", rouletteId: "r1", attemptId: "a1" },
        spin
      ),
      true
    );
    assert.equal(
      shouldDeferChatRouletteResultForLocalSpin(
        { phase: "result", rouletteId: "r1", attemptId: "a1" },
        spin,
        { forceResult: true }
      ),
      false
    );
    assert.equal(
      shouldDeferChatRouletteResultForLocalSpin(
        { phase: "result", rouletteId: "r1", attemptId: "a2" },
        spin
      ),
      false
    );
    assert.equal(
      shouldDeferChatRouletteResultForLocalSpin(
        { phase: "spinning", rouletteId: "r1", attemptId: "a1" },
        spin
      ),
      false
    );
    assert.equal(
      shouldDeferChatRouletteResultForLocalSpin(
        { phase: "result", rouletteId: "r1", attemptId: "a1" },
        null
      ),
      false
    );
  });
});
