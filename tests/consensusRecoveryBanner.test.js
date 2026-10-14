import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { consensusRecoveryBannerCopy } from "../js/games/consensus.js";

describe("consensus recovery banner copy", () => {
  it("answer affiche Reprendre la partie", () => {
    const copy = consensusRecoveryBannerCopy("answer");
    assert.equal(copy.hint, "Cette action n'est pas encore confirmée.");
    assert.equal(copy.button, "Reprendre la partie");
  });

  it("next-question affiche Reprendre la partie", () => {
    const copy = consensusRecoveryBannerCopy("next-question");
    assert.equal(copy.hint, "Cette action n'est pas encore confirmée.");
    assert.equal(copy.button, "Reprendre la partie");
  });

  it("reveal conserve Voir la partie et un texte distinct", () => {
    const copy = consensusRecoveryBannerCopy("reveal");
    assert.equal(
      copy.hint,
      "Cette action n'est pas encore confirmée. L'écran continue d'afficher la partie."
    );
    assert.equal(copy.button, "Voir la partie");
  });

  it("play conserve Voir la partie et un texte distinct", () => {
    const copy = consensusRecoveryBannerCopy("play");
    assert.equal(
      copy.hint,
      "Cette action n'est pas encore confirmée. L'écran continue d'afficher la partie."
    );
    assert.equal(copy.button, "Voir la partie");
  });

  it("le clic reste sur rereadSharedConsensus et le poll ne reprend rien", () => {
    const src = fs.readFileSync(new URL("../js/games/consensus.js", import.meta.url), "utf8");
    const clickAt = src.indexOf('"#btn-consensus-recheck"');
    const click = src.slice(clickAt, src.indexOf("const newScrollEl", clickAt));
    assert.match(click, /rereadSharedConsensus\(\)/);
    assert.equal(click.includes("resumeConsensusAnswer"), false);
    assert.equal(click.includes("resumeConsensusNextQuestion"), false);
    const pollAt = src.indexOf("const unsub = onGameSessionChange");
    const poll = src.slice(pollAt, src.indexOf("render();\n  lastAckedActingHostToken", pollAt));
    assert.equal(poll.includes("rereadSharedConsensus"), false);
    assert.equal(poll.includes("resumeConsensusAnswer"), false);
    assert.equal(poll.includes("resumeConsensusNextQuestion"), false);
    const hostSrc = fs.readFileSync(new URL("../js/core/hostPresence.js", import.meta.url), "utf8");
    assert.match(hostSrc, /export function resolveActingHostUserId/);
    assert.match(hostSrc, /\.sort\(\(a, b\) => String\(a\)\.localeCompare\(String\(b\)\)\)/);
    const life = fs.readFileSync(new URL("../js/config/lobbyLifecycle.js", import.meta.url), "utf8");
    assert.match(life, /HOST_PRESENCE_STALE_MS = 120 \* 1000/);
  });
});
