/**
 * Audit achats n°3 bis — les achats de test (sandbox : TestFlight, testeurs Play,
 * Test Store RevenueCat) sont gratuits ; le webhook leur donnait pourtant de vrais
 * droits en prod. Ils sont maintenant ignorés, sauf pour les comptes autorisés
 * (REVENUECAT_SANDBOX_ALLOWED_USER_IDS).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isIgnoredSandboxEvent } from "../supabase/functions/revenuecat-webhook/premium.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const USER = "11111111-1111-4111-8111-111111111111";
const TESTER = "22222222-2222-4222-8222-222222222222";

describe("Webhook RevenueCat : achats de test (repli sans clé RevenueCat)", () => {
  it("achat réel (production) : traité normalement", () => {
    assert.equal(isIgnoredSandboxEvent({ environment: "PRODUCTION" }, USER, ""), false);
    assert.equal(isIgnoredSandboxEvent({}, USER, ""), false);
  });

  it("achat de test : ignoré par défaut", () => {
    assert.equal(isIgnoredSandboxEvent({ environment: "SANDBOX" }, USER, ""), true);
    assert.equal(isIgnoredSandboxEvent({ environment: "sandbox" }, USER, ""), true);
  });

  it("achat de test d'un compte autorisé : traité (pour pouvoir tester)", () => {
    const allowed = ` ${TESTER.toUpperCase()} , autre `;
    assert.equal(isIgnoredSandboxEvent({ environment: "SANDBOX" }, TESTER, allowed), false);
    assert.equal(isIgnoredSandboxEvent({ environment: "SANDBOX" }, USER, allowed), true);
  });

  it("le webhook fait ce contrôle avant toute écriture", () => {
    const src = read("supabase/functions/revenuecat-webhook/index.ts");
    assert.match(src, /isIgnoredSandboxEvent,/);
    assert.match(src, /Deno\.env\.get\("REVENUECAT_SANDBOX_ALLOWED_USER_IDS"\)/);
    const fallback = src.slice(src.indexOf("--- Repli"));
    assert.ok(fallback.indexOf('skipped: "sandbox"') < fallback.indexOf("writeFlags("));
  });

  it("même résultat dans le miroir testé et dans le module du webhook", async () => {
    const { isIgnoredSandboxEvent: mirror } = await import("../supabase/revenuecat-entitlement-patch.js");
    const cases = [
      [{ environment: "PRODUCTION" }, USER, ""],
      [{}, USER, TESTER],
      [{ environment: "SANDBOX" }, USER, ""],
      [{ environment: "sandbox" }, TESTER, ` ${TESTER.toUpperCase()} `],
      [{ environment: "SANDBOX" }, USER, `${TESTER},`],
    ];
    for (const [event, userId, allowed] of cases) {
      assert.equal(mirror(event, userId, allowed), isIgnoredSandboxEvent(event, userId, allowed));
    }
  });
});
