import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTierNightLiveRevealNetworkUncertainty,
  evaluateTierNightLiveRevealRecovery,
  decideTierNightLiveRevealAction,
  tierNightLiveRevealChromeState,
  createTierNightLiveRevealLock,
  tierNightLiveRevealLockKey,
  TIER_NIGHT_LIVE_REVEAL_AUTO_ALERT,
} from "../js/core/tierNightLiveReveal.js";
import { isNewSpeedVoteVoteRound } from "../js/core/sessionMerge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = () => readFileSync(join(root, "js/games/tierNightLive.js"), "utf8");
const sessionSrc = () =>
  readFileSync(join(root, "js/core/tierNightLiveSession.js"), "utf8");

describe("BUG-TIERNIGHT-03 - decideTierNightLiveRevealAction", () => {
  it("1. auto + all-in + host → commit", () => {
    const d = decideTierNightLiveRevealAction({
      phase: "voting",
      canActAsHost: true,
      allVotesIn: true,
      source: "auto",
    });
    assert.equal(d.action, "commit");
    assert.equal(d.requireAllVotes, true);
  });

  it("2. host last path équivalent (même décision auto)", () => {
    const d = decideTierNightLiveRevealAction({
      phase: "voting",
      canActAsHost: true,
      allVotesIn: true,
      source: "auto",
    });
    assert.equal(d.action, "commit");
  });

  it("3. mount/catch-up all-in → commit", () => {
    assert.equal(
      decideTierNightLiveRevealAction({
        phase: "voting",
        canActAsHost: true,
        allVotesIn: true,
        source: "auto",
      }).action,
      "commit"
    );
  });

  it("4. non-hôte → noop", () => {
    assert.equal(
      decideTierNightLiveRevealAction({
        phase: "voting",
        canActAsHost: false,
        allVotesIn: true,
        source: "auto",
      }).reason,
      "not-host"
    );
  });

  it("5. votes incomplets auto → noop", () => {
    assert.equal(
      decideTierNightLiveRevealAction({
        phase: "voting",
        canActAsHost: true,
        allVotesIn: false,
        source: "auto",
      }).reason,
      "incomplete"
    );
  });

  it("manuel peut forcer sans all-in", () => {
    const d = decideTierNightLiveRevealAction({
      phase: "voting",
      canActAsHost: true,
      allVotesIn: false,
      source: "manual",
    });
    assert.equal(d.action, "commit");
    assert.equal(d.requireAllVotes, false);
  });

  it("9. phase déjà reveal → noop", () => {
    assert.equal(
      decideTierNightLiveRevealAction({
        phase: "reveal",
        canActAsHost: true,
        allVotesIn: true,
        source: "auto",
      }).reason,
      "already-reveal"
    );
  });

  it("16. auto après retryUsed → pas de boucle", () => {
    assert.equal(
      decideTierNightLiveRevealAction({
        phase: "voting",
        canActAsHost: true,
        allVotesIn: true,
        source: "auto",
        retryUsed: true,
      }).reason,
      "auto-exhausted"
    );
  });

  it("auto-retry toujours possible même si retryUsed (en cours)", () => {
    assert.equal(
      decideTierNightLiveRevealAction({
        phase: "voting",
        canActAsHost: true,
        allVotesIn: true,
        source: "auto-retry",
        retryUsed: true,
      }).action,
      "commit"
    );
  });
});

describe("BUG-TIERNIGHT-03 - concurrence / verrou", () => {
  it("6. plusieurs begin → une seule promesse active", async () => {
    const lock = createTierNightLiveRevealLock();
    lock.ensureSessionKey({ runId: "r1", roundIdx: 0 });
    let resolve;
    const p = new Promise((r) => {
      resolve = r;
    });
    lock.begin(p);
    assert.equal(lock.isInFlight(), true);
    assert.equal(lock.getInFlight(), p);
    const d = decideTierNightLiveRevealAction({
      phase: "voting",
      canActAsHost: true,
      allVotesIn: true,
      source: "manual",
      inFlight: lock.isInFlight(),
    });
    assert.equal(d.action, "await-inflight");
    resolve({ ok: true });
    await p;
    lock.clearInFlightIf(p);
    assert.equal(lock.isInFlight(), false);
  });

  it("7/8. auto + manuel / double-clic → await-inflight", () => {
    const d = decideTierNightLiveRevealAction({
      phase: "voting",
      canActAsHost: true,
      allVotesIn: true,
      source: "manual",
      inFlight: true,
    });
    assert.equal(d.action, "await-inflight");
  });

  it("10. changement de manche → verrou reset", () => {
    const lock = createTierNightLiveRevealLock();
    lock.ensureSessionKey({ runId: "r1", roundIdx: 0 });
    lock.markRetryUsed();
    lock.begin(Promise.resolve());
    lock.ensureSessionKey({ runId: "r1", roundIdx: 1 });
    assert.equal(lock.getRetryUsed(), false);
    assert.equal(lock.isInFlight(), false);
    assert.equal(lock.currentKey(), "r1:1");
  });

  it("11. nouveau runId → verrou reset", () => {
    const lock = createTierNightLiveRevealLock();
    lock.ensureSessionKey({ runId: "old", roundIdx: 0 });
    lock.markRetryUsed();
    lock.ensureSessionKey({ runId: "new", roundIdx: 0 });
    assert.equal(lock.getRetryUsed(), false);
    assert.equal(tierNightLiveRevealLockKey({ runId: "new", roundIdx: 0 }), "new:0");
  });

  it("canAutoRetry false après mark", () => {
    const lock = createTierNightLiveRevealLock();
    lock.ensureSessionKey({ runId: "r", roundIdx: 0 });
    assert.equal(lock.canAutoRetry(), true);
    lock.markRetryUsed();
    assert.equal(lock.canAutoRetry(), false);
  });
});

describe("BUG-TIERNIGHT-03 - recovery réseau", () => {
  it("12. erreur certaine n'est pas uncertainty", () => {
    assert.equal(
      isTierNightLiveRevealNetworkUncertainty(new Error("NOT_ALLOWED")),
      false
    );
  });

  it("13. timeout + remote reveal → recovered", () => {
    assert.equal(isTierNightLiveRevealNetworkUncertainty(new Error("timeout")), true);
    const rec = evaluateTierNightLiveRevealRecovery(
      { runId: "r1", roundIdx: 0, phase: "reveal" },
      { runId: "r1", roundIdx: 0 }
    );
    assert.equal(rec.recovered, true);
    assert.equal(rec.reason, "remote_reveal");
  });

  it("14. timeout + toujours voting → not recovered", () => {
    const rec = evaluateTierNightLiveRevealRecovery(
      { runId: "r1", roundIdx: 0, phase: "voting" },
      { runId: "r1", roundIdx: 0 }
    );
    assert.equal(rec.recovered, false);
    assert.equal(rec.reason, "still_voting");
  });

  it("stale run / round rejetés", () => {
    assert.equal(
      evaluateTierNightLiveRevealRecovery(
        { runId: "other", roundIdx: 0, phase: "reveal" },
        { runId: "r1", roundIdx: 0 }
      ).reason,
      "stale_run"
    );
    assert.equal(
      evaluateTierNightLiveRevealRecovery(
        { runId: "r1", roundIdx: 2, phase: "reveal" },
        { runId: "r1", roundIdx: 0 }
      ).reason,
      "stale_round"
    );
  });
});

describe("BUG-TIERNIGHT-03 - chrome UI", () => {
  it("17. all-in → hint Tout le monde a voté", () => {
    const c = tierNightLiveRevealChromeState({
      allIn: true,
      revealPending: false,
      votedCount: 3,
      totalPlayers: 3,
      hasLocalVote: true,
    });
    assert.match(c.hint, /Tout le monde a voté/);
    assert.equal(c.buttonDisabled, false);
  });

  it("révélation en cours désactive le CTA", () => {
    const c = tierNightLiveRevealChromeState({
      allIn: true,
      revealPending: true,
      votedCount: 3,
      totalPlayers: 3,
    });
    assert.match(c.hint, /Révélation en cours/);
    assert.equal(c.buttonDisabled, true);
  });

  it("alerte auto documentée", () => {
    assert.match(TIER_NIGHT_LIVE_REVEAL_AUTO_ALERT, /Révéler maintenant/);
  });
});

describe("BUG-TIERNIGHT-03 - wiring (04/05 préservés, SpeedVote inchangé)", () => {
  it("expose helper sécurisé + plus de void transitionToReveal silencieux", () => {
    const src = gameSrc();
    assert.match(src, /commitTierNightLiveRevealSafely/);
    assert.match(src, /runRevealSafely/);
    assert.match(src, /createTierNightLiveRevealLock/);
    assert.match(src, /maybeAutoRevealFromSession/);
    assert.equal(/void transitionToReveal\(\)/.test(src), false);
    assert.equal(/function transitionToReveal/.test(src), false);
    assert.match(src, /setRevealPending/);
    assert.match(src, /TIER_NIGHT_LIVE_REVEAL_AUTO_ALERT/);
    assert.match(
      readFileSync(join(root, "js/core/tierNightLiveReveal.js"), "utf8"),
      /Révélation en cours/
    );
  });

  it("18. refreshVotingChrome ciblé présent", () => {
    const src = gameSrc();
    assert.match(src, /function refreshVotingChrome/);
    assert.match(src, /setRevealPending/);
  });

  it("session expose commitTierNightLiveRevealSafely + refresh recovery", () => {
    const src = sessionSrc();
    assert.match(src, /export async function commitTierNightLiveRevealSafely/);
    assert.match(src, /refreshGameSession/);
    assert.match(src, /evaluateTierNightLiveRevealRecovery/);
    assert.match(src, /isTierNightLiveRevealNetworkUncertainty/);
  });

  it("19/20. contrats 04/05 inchangés dans le game (roster UID, allVotesIn)", () => {
    const src = gameSrc();
    assert.match(src, /allTierNightLiveVotesIn/);
    assert.match(src, /getTierNightLiveVoteProgress/);
    assert.match(src, /expectedPlayersForLive/);
    assert.match(src, /sessionHasTierNightPlayerRoster/);
    // Pas de gate getActivePlayers() pour all-in
    assert.equal(
      /allTierNightLiveVotesIn[\s\S]{0,40}getActivePlayers\(/.test(src),
      false
    );
  });

  it("SpeedVote helper partagé non modifié par ce ticket", () => {
    // isNewSpeedVoteVoteRound reste exporté et indépendant
    assert.equal(typeof isNewSpeedVoteVoteRound, "function");
    assert.equal(
      isNewSpeedVoteVoteRound(
        { runId: "a", votes: { x: 1 } },
        { runId: "b", votes: {} }
      ),
      // SpeedVote ne wipe pas sur runId seul - comportement historique préservé
      false
    );
  });

  it("21-23. acting host = canActAsHost gate (wiring)", () => {
    const src = gameSrc();
    assert.match(src, /canActAsHost\(\)/);
    assert.match(
      src,
      /decideTierNightLiveRevealAction\(\{[\s\S]*?canActAsHost:\s*canActAsHost\(\)/
    );
  });
});
