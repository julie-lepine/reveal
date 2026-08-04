import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createSyncPending,
  DEFAULT_SYNC_PENDING_SOFT_MS,
} from "../js/core/syncPending.js";

describe("ARCH-22 createSyncPending", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("1 - état initial : visible false, token null", () => {
    const p = createSyncPending();
    assert.deepEqual(p.getState(), { visible: false, token: null });
    assert.equal(DEFAULT_SYNC_PENDING_SOFT_MS, 500);
  });

  it("2 - start() crée un token et reste invisible avant soft delay", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    const token = p.start();
    assert.equal(typeof token, "number");
    assert.equal(p.getState().token, token);
    assert.equal(p.getState().visible, false);
  });

  it("3 - pending à 499 ms : toujours invisible", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    p.start();
    mock.timers.tick(499);
    assert.equal(p.getState().visible, false);
  });

  it("4 - pending à 500 ms : visible", () => {
    const changes = [];
    const p = createSyncPending({
      softDelayMs: 500,
      onChange: (s) => changes.push({ ...s }),
    });
    p.start();
    mock.timers.tick(500);
    assert.equal(p.getState().visible, true);
    assert.ok(changes.some((c) => c.visible === true));
  });

  it("5 - end(token) avant 500 ms : jamais de passage visible tardif", () => {
    const changes = [];
    const p = createSyncPending({
      softDelayMs: 500,
      onChange: (s) => changes.push({ ...s }),
    });
    const token = p.start();
    mock.timers.tick(200);
    p.end(token);
    mock.timers.tick(1000);
    assert.equal(p.getState().visible, false);
    assert.equal(p.getState().token, null);
    assert.equal(
      changes.filter((c) => c.visible === true).length,
      0,
      "aucun visible après end précoce"
    );
  });

  it("6 - end(token) après visibilité : retour idle", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    const token = p.start();
    mock.timers.tick(500);
    assert.equal(p.getState().visible, true);
    p.end(token);
    assert.deepEqual(p.getState(), { visible: false, token: null });
  });

  it("7 - start(A), start(B), end(A) : B reste courant", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    const a = p.start();
    const b = p.start();
    assert.notEqual(a, b);
    p.end(a);
    assert.equal(p.getState().token, b);
    assert.equal(p.getState().visible, false);
  });

  it("8 - timer de A ne rend pas B visible prématurément", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    p.start(); // A
    mock.timers.tick(400);
    p.start(); // B at t=400
    mock.timers.tick(100); // t=500 : A aurait été visible, pas B
    assert.equal(p.getState().visible, false);
    mock.timers.tick(400); // t=900 : B soft depuis 400 → visible
    assert.equal(p.getState().visible, true);
  });

  it("9 - end(B) termine correctement B", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    p.start();
    const b = p.start();
    mock.timers.tick(500);
    assert.equal(p.getState().visible, true);
    p.end(b);
    assert.deepEqual(p.getState(), { visible: false, token: null });
  });

  it("10 - dispose() avant expiration : aucun callback tardif", () => {
    let calls = 0;
    const p = createSyncPending({
      softDelayMs: 500,
      onChange: () => {
        calls += 1;
      },
    });
    p.start();
    const afterStart = calls;
    p.dispose();
    mock.timers.tick(1000);
    assert.equal(calls, afterStart);
    assert.deepEqual(p.getState(), { visible: false, token: null });
  });

  it("11 - dispose() après visibilité : aucun callback / effet tardif", () => {
    let calls = 0;
    const p = createSyncPending({
      softDelayMs: 500,
      onChange: () => {
        calls += 1;
      },
    });
    const token = p.start();
    mock.timers.tick(500);
    const afterVisible = calls;
    p.dispose();
    p.end(token);
    mock.timers.tick(1000);
    assert.equal(calls, afterVisible);
  });

  it("12 - dispose() répété sans erreur", () => {
    const p = createSyncPending();
    p.start();
    p.dispose();
    p.dispose();
    p.dispose();
    assert.deepEqual(p.getState(), { visible: false, token: null });
  });

  it("13 - end() token inconnu / obsolète : no-op", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    const a = p.start();
    const b = p.start();
    p.end(9999);
    assert.equal(p.getState().token, b);
    p.end(a);
    assert.equal(p.getState().token, b);
    mock.timers.tick(500);
    assert.equal(p.getState().visible, true);
  });

  it("14 - getState() ne mute pas l’état interne", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    p.start();
    const s = p.getState();
    s.visible = true;
    s.token = 42;
    assert.equal(p.getState().visible, false);
    assert.notEqual(p.getState().token, 42);
  });

  it("start après dispose → null, sans effet", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    p.dispose();
    assert.equal(p.start(), null);
    mock.timers.tick(500);
    assert.deepEqual(p.getState(), { visible: false, token: null });
  });
});
