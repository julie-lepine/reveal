import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Contrat pur actingHostNotice :
 * - ack uniquement après show effectif
 * - pas de re-show pour un token déjà ack
 * - nouveau token → peut re-afficher
 * - vrai hôte → jamais
 */
function decideActingHostNotice({
  wasActing,
  isActing,
  isRealHost,
  token,
  notifiedTokens,
  inActivePlaySession,
}) {
  if (wasActing === null) {
    return { show: false, nextWasActing: isActing, ackAfterShow: false };
  }
  const became = wasActing === false && isActing === true;
  const nextWasActing = isActing;
  if (!became || isRealHost) {
    return { show: false, nextWasActing, ackAfterShow: false };
  }
  if (!Number.isFinite(token) || notifiedTokens.has(token)) {
    return { show: false, nextWasActing, ackAfterShow: false };
  }
  if (!inActivePlaySession) {
    // Pas d'ack hors manche
    return { show: false, nextWasActing, ackAfterShow: false };
  }
  return { show: true, nextWasActing, ackAfterShow: true };
}

describe("acting host notice transition", () => {
  it("seed : pas de toast, pas d'ack", () => {
    const r = decideActingHostNotice({
      wasActing: null,
      isActing: true,
      isRealHost: false,
      token: 0,
      notifiedTokens: new Set(),
      inActivePlaySession: true,
    });
    assert.equal(r.show, false);
    assert.equal(r.ackAfterShow, false);
  });

  it("transition non-acting → acting en manche : toast + ack après show", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 1,
      notifiedTokens: new Set(),
      inActivePlaySession: true,
    });
    assert.equal(r.show, true);
    assert.equal(r.ackAfterShow, true);
  });

  it("même token déjà ack : pas de toast", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 1,
      notifiedTokens: new Set([1]),
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
      notifiedTokens: new Set([1]),
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
      notifiedTokens: new Set(),
      inActivePlaySession: true,
    });
    assert.equal(r.show, false);
  });

  it("hors manche : pas de toast et pas d'ack", () => {
    const r = decideActingHostNotice({
      wasActing: false,
      isActing: true,
      isRealHost: false,
      token: 4,
      notifiedTokens: new Set(),
      inActivePlaySession: false,
    });
    assert.equal(r.show, false);
    assert.equal(r.ackAfterShow, false);
  });
});
