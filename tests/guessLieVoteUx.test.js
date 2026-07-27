/**
 * Guess Lie UX — Vague A (vote in-flight) + Vague B1 (stats post-RPC).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSrc(rel) {
  return readFileSync(join(__dirname, rel), "utf8");
}

function extractTransitionToReveal(src) {
  const start = src.indexOf("async function transitionToReveal()");
  assert.notEqual(start, -1, "transitionToReveal introuvable");
  const bodyStart = src.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(bodyStart + 1, i);
    }
  }
  throw new Error("transitionToReveal non fermée");
}

describe("Guess Lie UX Vague A — contrats source vote", () => {
  const src = readSrc("../js/games/guessLie.js");

  it("import voteConfirmChrome / pickForVoteConfirm", () => {
    assert.match(src, /import \{ voteConfirmChrome, pickForVoteConfirm \} from "\.\.\/core\/voteConfirm\.js"/);
  });

  it("état vote : myVote + voteCommitInFlight + submitVote", () => {
    assert.match(src, /let myVote = null/);
    assert.match(src, /let voteCommitInFlight = null/);
    assert.match(src, /async function submitVote\(pick\)/);
  });

  it("submitVote : lock + pending + render() avant await commitGuessLieVote", () => {
    const fn = src.slice(src.indexOf("async function submitVote"));
    const fnEnd = fn.indexOf("\n  function render()");
    const body = fn.slice(0, fnEnd);
    assert.match(
      body,
      /voteCommitInFlight = pick;\s*\n\s*const pendingToken = syncPending\.start\(\);\s*\n\s*render\(\)/
    );
    assert.match(body, /await commitGuessLieVote\(pick\)/);
    assert.ok(body.indexOf("render()") < body.indexOf("await commitGuessLieVote"));
  });

  it("verrou anti double-clic : voteCommitInFlight != null", () => {
    assert.match(src, /if \(pick == null \|\| voteCommitInFlight != null\) return/);
  });

  it("bouton Envoi… seulement si soft pending visible", () => {
    assert.match(
      src,
      /syncPending\.getState\(\)\.visible\s*\?\s*"Envoi…"\s*:\s*confirm\.confirmLabel/
    );
    assert.match(src, /pendingVisible \? "Envoi…" : confirm\.confirmLabel/);
  });

  it("syncFromGl ne copie plus selected depuis votes commités", () => {
    assert.doesNotMatch(src, /selected = gl\.votes\[localName\]/);
    assert.match(src, /myVote = serverPick/);
    assert.match(src, /voteCommitInFlight != null\)[\s\S]*myVote = voteCommitInFlight/);
  });

  it("confirm délégué à submitVote + localPick", () => {
    assert.match(src, /void submitVote\(localPick\(\)\)/);
    assert.doesNotMatch(src, /#confirm.*addEventListener\("click", async/);
  });

  it("patchVotingChrome met à jour hint et #confirm", () => {
    const patch = src.slice(src.indexOf("function patchVotingChrome"), src.indexOf("let lastAckedActingHostToken"));
    assert.match(patch, /voteConfirmChrome\(/);
    assert.match(patch, /#confirm/);
    assert.match(patch, /Envoi…/);
  });

  it("pas de logique vote inline dupliquée (hasPendingChange / committedVote)", () => {
    assert.doesNotMatch(src, /const committedVote = votes\[localName\]/);
    assert.doesNotMatch(src, /hasPendingChange/);
  });
});

describe("Guess Lie UX Vague B1 — stats après RPC réussie", () => {
  const src = readSrc("../js/games/guessLie.js");
  const revealBody = extractTransitionToReveal(src);

  it("recordGuessLieRoundStats après await commitGuessLiePlay", () => {
    const commitIdx = revealBody.indexOf("await commitGuessLiePlay(");
    const statsIdx = revealBody.indexOf("recordGuessLieRoundStats(");
    assert.notEqual(commitIdx, -1);
    assert.notEqual(statsIdx, -1);
    assert.ok(statsIdx > commitIdx, "stats doit suivre le commit RPC");
  });

  it("recordGuessLieRoundStats absent avant commitGuessLiePlay", () => {
    const beforeCommit = revealBody.slice(0, revealBody.indexOf("await commitGuessLiePlay("));
    assert.doesNotMatch(beforeCommit, /recordGuessLieRoundStats\(/);
  });

  it("awardGuessLieRound reste avant commit (hors scope B1)", () => {
    const commitIdx = revealBody.indexOf("await commitGuessLiePlay(");
    const awardIdx = revealBody.indexOf("awardGuessLieRound(");
    assert.ok(awardIdx > -1 && awardIdx < commitIdx);
  });
});
