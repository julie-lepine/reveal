import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideActingHostNotice } from "../js/core/presenceUiLive.js";

describe("acting host notice transition", () => {
  it("seed déjà acting (wasActing true) : pas de toast", () => {
    const r = decideActingHostNotice({
      wasActing: true,
      isActing: true,
      isRealHost: false,
      token: 0,
      ackedTokens: new Set(),
      inActivePlaySession: true,
    });
    assert.equal(r.show, false);
  });

  it("transition non-acting → acting en manche : toast + ack après show", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 1,
      ackedTokens: new Set(),
      inActivePlaySession: true,
    });
    assert.equal(r.show, true);
  });

  it("même token déjà ack : pas de toast", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 1,
      ackedTokens: new Set([1]),
      inActivePlaySession: true,
    });
    assert.equal(r.show, false);
  });

  it("nouveau token après une élection précédente : peut re-afficher", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 2,
      ackedTokens: new Set([1]),
      inActivePlaySession: true,
    });
    assert.equal(r.show, true);
  });

  it("vrai hôte : jamais de toast acting", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: true,
      token: 3,
      ackedTokens: new Set(),
      inActivePlaySession: true,
    });
    assert.equal(r.show, false);
  });

  it("hors manche : pending sans ack", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 4,
      ackedTokens: new Set(),
      inActivePlaySession: false,
    });
    assert.equal(r.show, false);
    assert.equal(r.pending, true);
  });

  it("nudge avec wasActing null (listener tardif) : show si en manche", () => {
    const r = decideActingHostNotice({
      wasActing: null,
      isActing: true,
      isRealHost: false,
      token: 5,
      ackedTokens: new Set(),
      inActivePlaySession: true,
    });
    assert.equal(r.show, true);
  });
});
