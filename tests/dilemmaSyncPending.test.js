/**
 * ARCH-22 Vague C - Dilemma × createSyncPending (contrats source + lifecycle).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../js/games/dilemma.js"), "utf8");

function extractSubmitVote(body) {
  const start = body.indexOf("async function submitVote(pick)");
  assert.notEqual(start, -1, "submitVote introuvable");
  const brace = body.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < body.length; i++) {
    if (body[i] === "{") depth += 1;
    else if (body[i] === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(brace, i + 1);
    }
  }
  throw new Error("submitVote non fermée");
}

describe("ARCH-22 Dilemma sync pending - contrats source", () => {
  it("importe createSyncPending", () => {
    assert.match(src, /import \{ createSyncPending \} from "\.\.\/core\/syncPending\.js"/);
  });

  it("double clic : garde voteCommitInFlight avant start", () => {
    const fn = extractSubmitVote(src);
    assert.match(fn, /if \(pick == null \|\| voteCommitInFlight != null\) return/);
    const lockIdx = fn.indexOf("voteCommitInFlight = pick");
    const startIdx = fn.indexOf("syncPending.start()");
    assert.ok(lockIdx >= 0 && startIdx > lockIdx);
  });

  it("libellé via visible, disable via inFlight", () => {
    assert.match(src, /const confirmBusy = voteCommitInFlight != null/);
    assert.match(
      src,
      /const confirmLabel = syncPending\.getState\(\)\.visible\s*\?\s*"Envoi…"\s*:\s*confirm\.confirmLabel/
    );
    assert.match(src, /confirm\.confirmDisabled \|\| confirmBusy \? "disabled"/);
  });

  it("finally : clear lock puis end(token)", () => {
    const fn = extractSubmitVote(src);
    const finallyIdx = fn.indexOf("} finally {");
    assert.ok(finallyIdx > 0);
    const finallyBlock = fn.slice(finallyIdx);
    const clearIdx = finallyBlock.indexOf("voteCommitInFlight = null");
    const endIdx = finallyBlock.indexOf("syncPending.end(pendingToken)");
    assert.ok(clearIdx >= 0 && endIdx > clearIdx, "clear lock avant end");
  });

  it("unmount : dispose syncPending", () => {
    assert.match(src, /onChange:\s*\(\)\s*=>\s*\{\s*\n\s*if \(unmounted\) return/);
    assert.match(src, /syncPending\.dispose\(\)/);
    const cleanup = src.slice(src.lastIndexOf("return () => {"));
    assert.match(cleanup, /syncPending\.dispose\(\)/);
  });

  it("ne touche pas patchGameStateWithFeedback / withPatchTimeout", () => {
    assert.doesNotMatch(src, /patchGameStateWithFeedback/);
    assert.doesNotMatch(src, /withPatchTimeout/);
  });
});
