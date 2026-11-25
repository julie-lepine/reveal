/**
 * Le skin saisonnier est recalculé au retour au premier plan et à minuit,
 * pas seulement au démarrage de l'appli.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { msUntilNextLocalMidnight } from "../js/core/eventSkin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "..", "js/core/eventSkin.js"), "utf8");

describe("rafraîchissement du skin saisonnier", () => {
  it("prochain minuit local, même un 31 décembre", () => {
    const now = new Date(2026, 11, 31, 23, 0, 0);
    const target = new Date(now.getTime() + msUntilNextLocalMidnight(now));
    assert.equal(target.getFullYear(), 2027);
    assert.equal(target.getMonth(), 0);
    assert.equal(target.getDate(), 1);
    assert.equal(target.getHours(), 0);
  });

  it("jamais moins d'une seconde", () => {
    const now = new Date(2026, 11, 25, 23, 59, 59, 999);
    assert.ok(msUntilNextLocalMidnight(now) >= 1000);
  });

  it("branché sur le retour au premier plan (web et appli)", () => {
    const init = src.slice(src.indexOf("function initEventSkinRefresh"));
    assert.match(init, /"visibilitychange"/);
    assert.match(init, /"appStateChange"/);
    assert.match(init, /refreshEventSkin\(\)/);
    const boot = src.slice(src.indexOf("export function initEventSkin()"));
    assert.match(boot, /initEventSkinRefresh\(\)/);
  });

  it("ne retouche le DOM que si le skin a changé", () => {
    const fn = src.slice(src.indexOf("export function refreshEventSkin"));
    assert.match(fn, /if \(nextId === appliedSkinId\) return next;/);
  });
});
