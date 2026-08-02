/**
 * BUG-TRUTHMETER-01B — contrats chemins MP reveal (pas de score client live).
 * Les verrous SQL réels sont prouvés par les scripts SQL rollback / runbook concurrence.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  mapTruthMeterVoteRpcError,
  mapTruthMeterRevealRpcError,
  validateTruthMeterRevealRequest,
  validateTruthMeterVoteRequest,
} from "../js/core/truthMeterRevealErrors.js";
import {
  evaluateTruthMeterRevealRecovery,
  evaluateTruthMeterVoteRecovery,
} from "../js/core/truthMeterRevealRecovery.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const truthJs = readFileSync(join(ROOT, "js/games/truthMeter.js"), "utf8");
const sessionJs = readFileSync(join(ROOT, "js/core/truthMeterSession.js"), "utf8");
const rpcJs = readFileSync(join(ROOT, "js/core/gameSessionRpc.js"), "utf8");
const sql01b = readFileSync(
  join(ROOT, "supabase/game-sessions-truthmeter-01b-reveal-round.sql"),
  "utf8"
);

describe("BUG-TRUTHMETER-01B — chemins MP sans score client", () => {
  it("transitionToReveal MP appelle commitTruthMeterReveal, pas awardTruthMeterRound", () => {
    const start = truthJs.indexOf("async function transitionToReveal");
    const end = truthJs.indexOf("async function goToReveal", start);
    const block = truthJs.slice(start, end);
    assert.match(block, /if \(mp\)/);
    assert.match(block, /commitTruthMeterReveal\(\)/);
    const soloMarker = block.indexOf("const author = affirmation");
    assert.ok(soloMarker > 0, "branche solo présente");
    const mpBranch = block.slice(0, soloMarker);
    assert.equal(/\bawardTruthMeterRound\b/.test(mpBranch), false);
    assert.equal(/\bvotesForAward\b/.test(mpBranch), false);
    assert.match(block.slice(soloMarker), /awardTruthMeterRound/);
  });

  it("forceReveal MP délègue à goToRevealPending (même chaîne → reveal RPC)", () => {
    const start = truthJs.indexOf("async function forceReveal");
    const end = truthJs.indexOf("async function startDisplayPhase", start);
    const block = truthJs.slice(start, end);
    assert.match(block, /ensureLocalVoteCommitted/);
    assert.match(block, /goToRevealPending/);
  });

  it("commitTruthMeterReveal = RPC reveal uniquement", () => {
    const start = sessionJs.indexOf("export async function commitTruthMeterReveal");
    const end = sessionJs.indexOf("export async function commitTruthMeterVote", start);
    const block = sessionJs.slice(start, end);
    assert.match(block, /rpcRevealTruthMeterRound/);
    assert.equal(block.includes("awardTruthMeterRound"), false);
    assert.equal(block.includes("commitHostGamePlay"), false);
    assert.equal(/matchScores\s*:/.test(block), false);
  });

  it("rpcRevealTruthMeterRound cible reveal_truth_meter_round", () => {
    assert.match(rpcJs, /reveal_truth_meter_round/);
    assert.match(rpcJs, /submit_truth_meter_vote/);
    assert.match(rpcJs, /p_lobby_id:\s*lobbyId/);
    assert.match(rpcJs, /p_run_id:\s*runId/);
    assert.match(rpcJs, /p_round_idx:\s*roundIdx/);
  });

  it("payload MP reveal n’envoie pas matchScores / votes complets", () => {
    const start = sessionJs.indexOf("export async function commitTruthMeterReveal");
    const end = sessionJs.indexOf("export async function commitTruthMeterVote", start);
    const block = sessionJs.slice(start, end);
    assert.match(block, /rpcRevealTruthMeterRound\(\{[\s\S]*lobbyId[\s\S]*runId[\s\S]*roundIdx/);
    assert.doesNotMatch(block, /votes:\s*votesToScore/);
    assert.doesNotMatch(block, /matchScores,/);
  });

  it("revealInFlight empêche double-clic concurrent", () => {
    const start = truthJs.indexOf("async function transitionToReveal");
    const block = truthJs.slice(start, start + 400);
    assert.match(block, /if \(revealInFlight\) return/);
  });

  it("passage distant reveal nettoie voteCommitInFlight", () => {
    assert.match(
      truthJs,
      /phase === "reveal" && prevPhase !== "reveal"[\s\S]*voteCommitInFlight = null/
    );
  });
});

describe("BUG-TRUTHMETER-01B — SQL contrats atomiques (source)", () => {
  it("reveal et submit partagent truth_meter_apply_reveal_scoring", () => {
    assert.match(sql01b, /create or replace function public\.truth_meter_apply_reveal_scoring/);
    assert.match(
      sql01b,
      /create or replace function public\.reveal_truth_meter_round[\s\S]*truth_meter_apply_reveal_scoring\(p_lobby_id/
    );
    assert.match(
      sql01b,
      /truth_meter_all_expected_voters_voted[\s\S]*truth_meter_apply_reveal_scoring/
    );
  });

  it("FOR UPDATE avant lecture scoring", () => {
    const revealStart = sql01b.indexOf("create or replace function public.reveal_truth_meter_round");
    const revealFn = sql01b.slice(revealStart, revealStart + 3500);
    const lockIdx = revealFn.search(/for update/i);
    const scoreIdx = revealFn.indexOf("truth_meter_apply_reveal_scoring");
    assert.ok(lockIdx > 0 && scoreIdx > lockIdx);
  });

  it("idempotence reveal si phase=reveal et roundScored", () => {
    assert.match(
      sql01b,
      /v_phase = 'reveal'[\s\S]*roundScored[\s\S]*return v_row/
    );
  });

  it("vote post-reveal → TRUTHMETER_INVALID_PHASE", () => {
    assert.match(
      sql01b,
      /submit_truth_meter_vote[\s\S]*TRUTHMETER_INVALID_PHASE/
    );
  });
});

describe("BUG-TRUTHMETER-01B — erreurs vote / recovery", () => {
  it("vote tardif → message dédié sans Réessaie", () => {
    const mapped = mapTruthMeterVoteRpcError(new Error("TRUTHMETER_INVALID_PHASE"));
    assert.match(mapped.message, /révélation a déjà commencé/i);
    assert.doesNotMatch(mapped.message, /Réessaie/);
  });

  it("validate reveal refuse hors voting/reveal-pending", () => {
    assert.equal(validateTruthMeterRevealRequest({ phase: "writing", runId: "x" }).ok, false);
    assert.equal(
      validateTruthMeterRevealRequest({ phase: "voting", runId: "x", roundIdx: 0 }).ok,
      true
    );
  });

  it("validate vote refuse en reveal", () => {
    assert.equal(
      validateTruthMeterVoteRequest({ phase: "reveal", runId: "x", roundIdx: 0 }).ok,
      false
    );
  });

  it("recovery reveal après timeout", () => {
    const r = evaluateTruthMeterRevealRecovery(
      { runId: "r1", roundIdx: 0, phase: "reveal", roundScored: true },
      { runId: "r1", roundIdx: 0 }
    );
    assert.equal(r.recovered, true);
  });

  it("recovery vote auto-revealed", () => {
    const r = evaluateTruthMeterVoteRecovery(
      {
        runId: "r1",
        roundIdx: 0,
        phase: "reveal",
        roundScored: true,
        lastRound: { deltas: {} },
        votes: { u1: 50 },
      },
      { runId: "r1", roundIdx: 0, choice: 50, localUid: "u1" }
    );
    assert.equal(r.recovered, true);
  });

  it("map reveal stale run", () => {
    const mapped = mapTruthMeterRevealRpcError(new Error("TRUTHMETER_STALE_RUN"));
    assert.match(mapped.message, /autre partie/i);
  });
});
