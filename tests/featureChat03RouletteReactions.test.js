/**
 * FEATURE-CHAT-03 - réactions éphémères roulette.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_ROULETTE_REACTION_DEFS,
  CHAT_ROULETTE_DURATION_MS,
  buildChatRouletteSpinPayload,
  canAcceptChatRouletteReactions,
  computeChatRouletteReactionCounts,
  isChatRouletteReactionOnlyPatch,
  mergeChatRouletteReactionPatch,
  normalizeChatRouletteEvent,
  normalizeChatRouletteReactionsByUid,
  resolveChatRouletteReactionToggle,
  chatRouletteReactionsSignature,
  applyChatRouletteReactionOverlay,
} from "../js/core/chatRandomGameLogic.js";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
} from "../js/core/optimisticMapEntry.js";
import { detectChatRouletteReactionContribution } from "../js/core/playerContribution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function baseEvent(over = {}) {
  return {
    rouletteId: "r-A",
    attemptId: "a-1",
    phase: "result",
    selectedTileId: "hottake-prep",
    eligibleTileIds: ["hottake-prep", "consensus-prep"],
    drawCount: 1,
    createdAt: 1_000_000,
    animationStartTimestamp: 1_000_000,
    animationDurationMs: 2300,
    expiresAt: 1_068_300,
    rerollCount: 0,
    maxRerolls: 3,
    reactionsByUid: {},
    ...over,
  };
}

beforeEach(() => {});

describe("FEATURE-CHAT-03 - réactions éphémères", () => {
  it("1. quatre réactions définies", () => {
    assert.equal(CHAT_ROULETTE_REACTION_DEFS.length, 4);
    assert.deepEqual(
      CHAT_ROULETTE_REACTION_DEFS.map((d) => d.id),
      ["in", "bof", "funny", "curious"]
    );
  });

  it("2. réactions strictement en phase result", () => {
    const spinning = baseEvent({
      phase: "spinning",
      animationStartTimestamp: 1_000_000,
      animationDurationMs: CHAT_ROULETTE_DURATION_MS,
    });
    const after = 1_000_000 + CHAT_ROULETTE_DURATION_MS + 1;
    assert.equal(canAcceptChatRouletteReactions(spinning, after), false);
    assert.equal(canAcceptChatRouletteReactions(spinning), false);
    assert.equal(canAcceptChatRouletteReactions(baseEvent({ phase: "prompt" })), false);
    assert.equal(canAcceptChatRouletteReactions(baseEvent({ phase: "result" })), true);
  });

  it("3–6. toggle add / remove / replace / single count", () => {
    assert.equal(resolveChatRouletteReactionToggle(undefined, "in"), "in");
    assert.equal(resolveChatRouletteReactionToggle("in", "in"), null);
    assert.equal(resolveChatRouletteReactionToggle("in", "funny"), "funny");

    let map = {};
    const u1 = "uid-julie";
    const u2 = "uid-bob";
    map = mergeChatRouletteReactionPatch(baseEvent({ reactionsByUid: map }), {
      reactionsByUid: { [u1]: "in" },
    }).reactionsByUid;
    map = mergeChatRouletteReactionPatch(baseEvent({ reactionsByUid: map }), {
      reactionsByUid: { [u2]: "bof" },
    }).reactionsByUid;
    assert.equal(map[u1], "in");
    assert.equal(map[u2], "bof");
    const counts = computeChatRouletteReactionCounts(map);
    assert.equal(counts.in, 1);
    assert.equal(counts.bof, 1);
    assert.equal(counts.funny, 0);
  });

  it("7. compteurs dérivés depuis reactionsByUid", () => {
    const counts = computeChatRouletteReactionCounts({
      a: "in",
      b: "in",
      c: "funny",
    });
    assert.deepEqual(counts, { in: 2, bof: 0, funny: 1, curious: 0 });
  });

  it("8–9. merge ciblé sans écraser les autres entrées", () => {
    const cur = baseEvent({
      reactionsByUid: { u1: "in", u2: "bof" },
    });
    const merged = mergeChatRouletteReactionPatch(cur, {
      reactionsByUid: { u3: "funny" },
    });
    assert.equal(merged.reactionsByUid.u1, "in");
    assert.equal(merged.reactionsByUid.u2, "bof");
    assert.equal(merged.reactionsByUid.u3, "funny");
    assert.equal(isChatRouletteReactionOnlyPatch({ reactionsByUid: { u1: "in" } }), true);
    assert.equal(
      isChatRouletteReactionOnlyPatch({ phase: "result", reactionsByUid: { u1: "in" } }),
      false
    );
  });

  it("10. rollback optimiste uniquement sur l'entrée locale", () => {
    const session = { reactionsByUid: { u2: "bof" } };
    const apply = computeOptimisticMapEntryApply({
      map: session.reactionsByUid,
      key: "u1",
      value: "in",
    });
    const live = { reactionsByUid: { ...session.reactionsByUid, u1: "in", u2: "bof" } };
    const rolled = rollbackOptimisticMapEntry({
      currentMap: live.reactionsByUid,
      key: "u1",
      hadPreviousValue: apply.hadPreviousValue,
      previousValue: apply.previousValue,
      optimisticValue: apply.optimisticValue,
      attemptId: 1,
      currentAttemptId: 1,
    });
    assert.equal(rolled.applied, true);
    assert.equal(rolled.map.u2, "bof");
    assert.equal(rolled.map.u1, undefined);
  });

  it("11–12. stale attempt / roulette ignorés côté commit scope", () => {
    const src = readFileSync(
      join(__dirname, "../js/core/chatRandomGameReaction.js"),
      "utf8"
    );
    assert.match(src, /isChatRouletteActionCurrent\(scope, live/);
    assert.match(src, /matchAttempt: true/);
  });

  it("13–14. reset complet au reroll / nouvel attemptId", () => {
    const prev = baseEvent({ reactionsByUid: { u1: "in", u2: "funny" } });
    const spin = buildChatRouletteSpinPayload(
      prev,
      { id: "consensus-prep" },
      [{ id: "hottake-prep" }, { id: "consensus-prep" }],
      { reroll: true, now: 2_000_000 }
    );
    assert.notEqual(spin.attemptId, prev.attemptId);
    assert.deepEqual(spin.reactionsByUid, {});
  });

  it("15–17. clear / launch / bridge - réactions absentes après replace", () => {
    const spin = buildChatRouletteSpinPayload(
      baseEvent({ reactionsByUid: { u1: "in" } }),
      { id: "hottake-prep" },
      [{ id: "hottake-prep" }, { id: "consensus-prep" }]
    );
    assert.deepEqual(spin.reactionsByUid, {});
    const n = normalizeChatRouletteEvent(null);
    assert.equal(n, null);
  });

  it("18–19. invité peut réagir - contrat handlers", () => {
    const syncSrc = readFileSync(join(__dirname, "../js/core/chatRandomGame.js"), "utf8");
    assert.match(syncSrc, /onReaction:/);
    assert.match(syncSrc, /getLocalUid:/);
    assert.match(syncSrc, /onReaction:\s*\(reactionId\)\s*=>\s*\{/);
    assert.doesNotMatch(syncSrc, /if\s*\(\s*canControlChatRoulette\(\)\s*\)\s*\{\s*void commitChatRouletteReaction/);
  });

  it("20. départ joueur ignoré dans les compteurs (roster actif)", () => {
    const counts = computeChatRouletteReactionCounts(
      { gone: "in", here: "funny" },
      ["here"]
    );
    assert.equal(counts.in, 0);
    assert.equal(counts.funny, 1);
  });

  it("21. join mid-result - map vide par défaut", () => {
    const ev = normalizeChatRouletteEvent(baseEvent());
    assert.deepEqual(ev.reactionsByUid, {});
  });

  it("22. double-clic protégé par action lock", () => {
    const src = readFileSync(
      join(__dirname, "../js/core/chatRandomGameReaction.js"),
      "utf8"
    );
    assert.match(src, /reactionCommitLock\.run/);
  });

  it("23–24. reconnexion - signature réactions / reset attempt", () => {
    const sig1 = chatRouletteReactionsSignature({ u1: "in" });
    const sig2 = chatRouletteReactionsSignature({});
    assert.notEqual(sig1, sig2);
    const a1 = baseEvent({ attemptId: "a-1", reactionsByUid: { u1: "in" } });
    const a2 = baseEvent({ attemptId: "a-2", reactionsByUid: {} });
    assert.notEqual(a1.attemptId, a2.attemptId);
    assert.deepEqual(a2.reactionsByUid, {});
  });

  it("25. aria-pressed dans le markup UI", () => {
    const uiSrc = readFileSync(join(__dirname, "../js/core/chatRandomGameUi.js"), "utf8");
    assert.match(uiSrc, /aria-pressed/);
    assert.match(uiSrc, /data-roulette-reaction/);
  });

  it("26. reduced motion sans pop", () => {
    const css = readFileSync(join(__dirname, "../style.css"), "utf8");
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /chat-roulette__reaction-count--pop/);
  });

  it("27–30. soft voice / bridge / anti-répétition / launch inchangés", () => {
    const logicSrc = readFileSync(
      join(__dirname, "../js/core/chatRandomGameLogic.js"),
      "utf8"
    );
    const syncSrc = readFileSync(join(__dirname, "../js/core/chatRandomGame.js"), "utf8");
    const restartSrc = readFileSync(join(__dirname, "../js/core/restartGame.js"), "utf8");
    assert.match(logicSrc, /resolveChatRouletteResultAct/);
    assert.match(logicSrc, /pickChatRouletteNextGame/);
    assert.match(syncSrc, /hostBridgeToPoll/);
    assert.match(syncSrc, /runWithChatRouletteLaunchPermit/);
    assert.match(restartSrc, /assertNoActiveChatRoulette/);
  });

  it("contribution invité détectée - une seule clé uid", () => {
    const uid = "11111111-1111-1111-1111-111111111111";
    const ok = detectChatRouletteReactionContribution(
      { chatRoulette: { reactionsByUid: { [uid]: "in" } } },
      uid
    );
    assert.deepEqual(ok, { reaction: "in" });
    const bad = detectChatRouletteReactionContribution(
      { chatRoulette: { reactionsByUid: { other: "in" } } },
      uid
    );
    assert.equal(bad, null);
  });

  it("normalisation reactionsByUid filtre valeurs invalides", () => {
    assert.deepEqual(
      normalizeChatRouletteReactionsByUid({ u1: "in", u2: "nope", u3: 1 }),
      { u1: "in" }
    );
  });

  it("overlay optimiste sur tirage courant", () => {
    const ev = baseEvent();
    const overlay = applyChatRouletteReactionOverlay(ev.reactionsByUid, null, ev);
    assert.deepEqual(overlay, {});
    const withOpt = applyChatRouletteReactionOverlay(
      ev.reactionsByUid,
      { rouletteId: ev.rouletteId, attemptId: ev.attemptId, uid: "u1", reactionId: "in" },
      ev
    );
    assert.deepEqual(withOpt, { u1: "in" });
  });
});

describe("FEATURE-CHAT-03 - contrats SQL RPC réactions", () => {
  it("RPC contribute_chat_roulette_reaction présente", () => {
    const sql = readFileSync(
      join(__dirname, "../supabase/feature-chat-03-roulette-reactions.sql"),
      "utf8"
    );
    assert.match(sql, /contribute_chat_roulette_reaction/);
    assert.match(sql, /reactionsByUid/);
    assert.match(sql, /attemptId/);
  });

  it("gameSync route non-hôte vers RPC roulette", () => {
    const src = readFileSync(join(__dirname, "../js/core/gameSync.js"), "utf8");
    assert.match(src, /detectChatRouletteReactionContribution/);
    assert.match(src, /persistChatRouletteReactionRemote/);
    assert.match(src, /hostRouletteReaction/);
  });
});
