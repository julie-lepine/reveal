/**
 * Loader UI Join Vague A — chrome soft « Connexion… » sur Home (contrats source).
 * Pas de joinInFlight / locks métier : UX only via createSyncPending + paint.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSyncPending } from "../js/core/syncPending.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../js/screens/home.js"), "utf8");

function extractHandler(body, marker) {
  const start = body.indexOf(marker);
  assert.notEqual(start, -1, `handler introuvable: ${marker}`);
  // Prendre jusqu'au prochain grand `if (e.target.closest` au même niveau ou fin proche
  const from = body.slice(start);
  const nextIf = from.indexOf("\n    if (e.target.closest(", 1);
  return nextIf === -1 ? from : from.slice(0, nextIf);
}

describe("Loader UI Join Vague A — contrats source Home", () => {
  it("importe createSyncPending", () => {
    assert.match(src, /import \{ createSyncPending \} from "\.\.\/core\/syncPending\.js"/);
  });

  it("onChange garde shouldContinue puis scheduleRender", () => {
    assert.match(
      src,
      /onChange:\s*\(\)\s*=>\s*\{\s*\r?\n\s*if \(!shouldContinue\(\)\) return;\s*\r?\n\s*scheduleRender\(true\)/
    );
  });

  it("paint : libellé « Connexion… » seulement si getState().visible", () => {
    assert.match(
      src,
      /const joinPendingVisible = syncPending\.getState\(\)\.visible/
    );
    assert.match(
      src,
      /const joinPendingActive = syncPending\.getState\(\)\.token != null/
    );
    assert.match(
      src,
      /const joinLobbyLabel = joinPendingVisible \? "Connexion…" : "Rejoindre"/
    );
    assert.match(
      src,
      /const guestJoinLabel = joinPendingVisible\s*\?\s*"Connexion…"\s*:\s*"Rejoindre la partie →"/
    );
    assert.match(src, /id="btn-join-lobby"\$\{joinDisabledAttr\}>\$\{escapeHtml\(joinLobbyLabel\)\}/);
    assert.match(src, /id="btn-guest-join"\$\{joinDisabledAttr\}>\$\{escapeHtml\(guestJoinLabel\)\}/);
    assert.match(src, /joinLabel: guestJoinLabel/);
    assert.match(src, /joinDisabled: joinPendingActive/);
  });

  it("pas de mutation textContent comme source de vérité pending", () => {
    assert.doesNotMatch(src, /btn\.textContent\s*=\s*"Connexion…"/);
  });

  it("pas de joinInFlight (état métier dédié)", () => {
    assert.doesNotMatch(src, /joinInFlight/);
  });

  it("#btn-join-lobby : start après disable, end dans finally", () => {
    const fn = extractHandler(src, 'if (e.target.closest("#btn-join-lobby"))');
    assert.match(fn, /btn\.disabled = true/);
    const disableIdx = fn.indexOf("btn.disabled = true");
    const startIdx = fn.indexOf("syncPending.start()");
    assert.ok(startIdx > disableIdx);
    const finallyIdx = fn.indexOf("} finally {");
    assert.ok(finallyIdx > 0);
    const finallyBlock = fn.slice(finallyIdx);
    assert.match(finallyBlock, /syncPending\.end\(pendingToken\)/);
    assert.match(finallyBlock, /btn\.disabled = false/);
  });

  it("guest join/rejoin : start après disable, end dans finally", () => {
    const fn = extractHandler(
      src,
      'if (e.target.closest("#btn-guest-join") || e.target.closest("#btn-guest-rejoin"))'
    );
    assert.match(fn, /btn\.disabled = true/);
    const disableIdx = fn.indexOf("btn.disabled = true");
    const startIdx = fn.indexOf("syncPending.start()");
    assert.ok(startIdx > disableIdx);
    const finallyIdx = fn.indexOf("} finally {");
    assert.ok(finallyIdx > 0);
    assert.match(fn.slice(finallyIdx), /syncPending\.end\(pendingToken\)/);
  });

  it("unmount : dispose syncPending avant mount.dispose", () => {
    const cleanup = src.slice(src.lastIndexOf("return () => {"));
    const disposeIdx = cleanup.indexOf("syncPending.dispose()");
    const mountIdx = cleanup.indexOf("mount.dispose()");
    assert.ok(disposeIdx >= 0 && mountIdx > disposeIdx);
  });

  it("hors scope : resume / return / create sans syncPending.start", () => {
    const resume = extractHandler(src, 'if (e.target.closest("#btn-resume-evening"))');
    const ret = extractHandler(src, 'if (e.target.closest("#btn-return-lobby"))');
    const create = extractHandler(src, 'if (e.target.closest("#btn-create-lobby"))');
    assert.doesNotMatch(resume, /syncPending\.start/);
    assert.doesNotMatch(ret, /syncPending\.start/);
    assert.doesNotMatch(create, /syncPending\.start/);
  });
});

describe("Loader UI Join Vague A — soft delay (primitive)", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("avant 500 ms : pas visible ; à 500 ms : visible ; end : idle", () => {
    const changes = [];
    const p = createSyncPending({
      softDelayMs: 500,
      onChange: (s) => changes.push({ ...s }),
    });
    const token = p.start();
    assert.equal(p.getState().visible, false);
    mock.timers.tick(499);
    assert.equal(p.getState().visible, false);
    mock.timers.tick(1);
    assert.equal(p.getState().visible, true);
    p.end(token);
    assert.deepEqual(p.getState(), { visible: false, token: null });
  });

  it("end avant soft delay : jamais visible (succès/erreur rapide)", () => {
    const p = createSyncPending({ softDelayMs: 500 });
    const token = p.start();
    mock.timers.tick(200);
    p.end(token);
    mock.timers.tick(1000);
    assert.equal(p.getState().visible, false);
  });

  it("dispose : aucun callback tardif après unmount", () => {
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
  });
});
