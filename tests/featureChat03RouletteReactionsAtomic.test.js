/**
 * FEATURE-CHAT-03 — atomicité écriture réactions (lost update / RPC unique).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicMergeChatRouletteReactionEntry,
  simulateSerializedAtomicReactionWrites,
  simulateStaleHostReactionPatchLostUpdate,
  mergeChatRouletteReactionPatch,
} from "../js/core/chatRandomGameLogic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("FEATURE-CHAT-03 — lost update / atomicité", () => {
  it("ancien chemin hôte stale : deux writes concurrents depuis {} perdent une entrée", () => {
    const final = simulateStaleHostReactionPatchLostUpdate(
      {},
      [
        { uid: "A", reaction: "in" },
        { uid: "B", reaction: "funny" },
      ]
    );
    assert.deepEqual(final, { B: "funny" });
    assert.equal(final.A, undefined);
  });

  it("RPC atomique sérialisé : A + B concurrent → les deux présents", () => {
    const final = simulateSerializedAtomicReactionWrites({}, [
      { uid: "A", reaction: "in" },
      { uid: "B", reaction: "funny" },
    ]);
    assert.deepEqual(final, { A: "in", B: "funny" });
  });

  it("RPC atomique : A curious + B retire → { A: curious }", () => {
    const final = simulateSerializedAtomicReactionWrites(
      { A: "in", B: "funny" },
      [
        { uid: "A", reaction: "curious" },
        { uid: "B", reaction: null },
      ]
    );
    assert.deepEqual(final, { A: "curious" });
  });

  it("ordre des ops différents uids : résultat identique (commutatif)", () => {
    const a = simulateSerializedAtomicReactionWrites({}, [
      { uid: "A", reaction: "in" },
      { uid: "B", reaction: "funny" },
    ]);
    const b = simulateSerializedAtomicReactionWrites({}, [
      { uid: "B", reaction: "funny" },
      { uid: "A", reaction: "in" },
    ]);
    assert.deepEqual(a, b);
  });

  it("atomicMerge ne touche qu'une clé", () => {
    const next = atomicMergeChatRouletteReactionEntry(
      { A: "in", B: "bof" },
      "A",
      "curious"
    );
    assert.deepEqual(next, { A: "curious", B: "bof" });
  });

  it("mergeChatRouletteReactionPatch sûr si snapshot courant (optimiste local)", () => {
    const base = {
      rouletteId: "r1",
      attemptId: "a1",
      phase: "result",
      selectedTileId: "hottake-prep",
      eligibleTileIds: ["hottake-prep"],
      drawCount: 1,
      createdAt: 1,
      animationDurationMs: 2300,
      expiresAt: 999999,
      reactionsByUid: { A: "in" },
    };
    const merged = mergeChatRouletteReactionPatch(base, {
      reactionsByUid: { B: "funny" },
    });
    assert.deepEqual(merged.reactionsByUid, { A: "in", B: "funny" });
  });
});

describe("FEATURE-CHAT-03 — contrat chemin d'écriture réel", () => {
  it("commit utilise persistChatRouletteReactionRemote (RPC), pas patchGameState", () => {
    const src = readFileSync(
      join(__dirname, "../js/core/chatRandomGameReaction.js"),
      "utf8"
    );
    assert.match(src, /persistChatRouletteReactionRemote/);
    assert.match(src, /rpcContributeChatRouletteReaction/);
    assert.doesNotMatch(src, /patchGameStateWithFeedback/);
    assert.doesNotMatch(src, /patchGameState\(/);
  });

  it("hôte patchGameStateInner redirige réaction vers RPC", () => {
    const src = readFileSync(join(__dirname, "../js/core/gameSync.js"), "utf8");
    assert.match(src, /hostRouletteReaction/);
    assert.match(src, /persistChatRouletteReactionRemote/);
    assert.doesNotMatch(
      src,
      /isChatRouletteReactionOnlyPatch\(incCr\)/
    );
  });

  it("invité patchGameStateAsNonHost redirige vers persistChatRouletteReactionRemote", () => {
    const src = readFileSync(join(__dirname, "../js/core/gameSync.js"), "utf8");
    const block = src.slice(
      src.indexOf("detectChatRouletteReactionContribution(stateMerge, uid)"),
      src.indexOf("const contribution = detectPlayerContribution")
    );
    assert.match(block, /persistChatRouletteReactionRemote/);
  });

  it("SQL RPC : FOR UPDATE + jsonb_set clé UID", () => {
    const sql = readFileSync(
      join(__dirname, "../supabase/feature-chat-03-roulette-reactions.sql"),
      "utf8"
    );
    assert.match(sql, /for update/i);
    assert.match(sql, /jsonb_set\(v_reactions, array\[v_uid_text\]/);
    assert.match(sql, /v_reactions := v_reactions - v_uid_text/);
    assert.match(sql, /attemptId/);
    assert.match(sql, /rouletteId/);
  });

  it("rollback local ne supprime pas entrée d'un autre joueur", () => {
    const src = readFileSync(
      join(__dirname, "../js/core/chatRandomGameReaction.js"),
      "utf8"
    );
    assert.match(src, /rollbackOptimisticMapEntry/);
    assert.match(src, /key: captured\.uid/);
  });
});
