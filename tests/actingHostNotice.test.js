import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideActingHostNotice } from "../js/core/presenceUiLive.js";
import { needsActingHostUiRefresh } from "../js/core/hostPresence.js";

describe("acting host notice - election nudge vs bad seed", () => {
  it("seed wasActing=true puis election nudge : notice demandée (pas avalée)", () => {
    const r = decideActingHostNotice({
      wasActing: true, // seed après patch state (bug historique)
      isActing: true,
      isRealHost: false,
      token: 1,
      ackedTokens: new Set(),
      inActivePlaySession: true,
      fromElectionNudge: true,
      dialogOpen: false,
    });
    assert.equal(r.show, true);
    assert.equal(r.pending, false);
  });

  it("sans fromElectionNudge et déjà acting : pas de toast", () => {
    const r = decideActingHostNotice({
      wasActing: true,
      isActing: true,
      isRealHost: false,
      token: 1,
      ackedTokens: new Set(),
      inActivePlaySession: true,
      fromElectionNudge: false,
    });
    assert.equal(r.show, false);
  });

  it("dialog ouvert : pending, pas d'ack", () => {
    const acked = new Set();
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 2,
      ackedTokens: acked,
      inActivePlaySession: true,
      fromElectionNudge: true,
      dialogOpen: true,
    });
    assert.equal(r.show, false);
    assert.equal(r.pending, true);
    assert.equal(r.deferReason, "dialog-open");
    assert.equal(acked.has(2), false);
  });

  it("écran hub : pending not-active-session", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 3,
      ackedTokens: new Set(),
      inActivePlaySession: false,
      fromElectionNudge: true,
    });
    assert.equal(r.show, false);
    assert.equal(r.pending, true);
    assert.equal(r.deferReason, "not-active-session-screen");
  });

  it("vrai hôte : jamais", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: true,
      token: 4,
      ackedTokens: new Set(),
      inActivePlaySession: true,
      fromElectionNudge: true,
    });
    assert.equal(r.show, false);
    assert.equal(r.deferReason, "real-host");
  });

  it("scénario sans remount : seed false → election → show → ack token → pas de 2e", () => {
    const acked = new Set();
    const d1 = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 5,
      ackedTokens: acked,
      inActivePlaySession: true,
      fromElectionNudge: true,
    });
    assert.equal(d1.show, true);
    acked.add(5);
    const d2 = decideActingHostNotice({
      wasActing: true,
      isActing: true,
      isRealHost: false,
      token: 5,
      ackedTokens: acked,
      inActivePlaySession: true,
      fromElectionNudge: true,
    });
    assert.equal(d2.show, false);
  });

  it("nudge UI token : force refresh même si phase inchangée", () => {
    assert.equal(needsActingHostUiRefresh(0, 1), true);
    assert.equal(needsActingHostUiRefresh(1, 1), false);
  });

  it("ordre critique : election avant seed bundle (simulation)", () => {
    // Avant fix : notifyLobby seed wasActing=true puis nudge → no show
    // Après fix : nudge d'abord avec wasActing=false → show
    let wasActing = false;
    const afterNudgeFirst = decideActingHostNotice({
      wasActing,
      isActing: true,
      isRealHost: false,
      token: 7,
      ackedTokens: new Set(),
      inActivePlaySession: true,
      fromElectionNudge: true,
    });
    assert.equal(afterNudgeFirst.show, true);
    wasActing = true; // seed bundle après
    const afterBadOrder = decideActingHostNotice({
      wasActing: true,
      isActing: true,
      isRealHost: false,
      token: 8,
      ackedTokens: new Set(),
      inActivePlaySession: true,
      fromElectionNudge: true, // même avec seed bad, election nudge sauve
    });
    assert.equal(afterBadOrder.show, true);
  });
});
