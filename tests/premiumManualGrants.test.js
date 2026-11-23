/**
 * Droits offerts (table premium_manual_grants) : ajoutés aux droits des achats
 * par le webhook RevenueCat, jamais retirés (ni par un recalcul, ni par un
 * remboursement).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyManualGrant,
  premiumFlagsFromPurchases,
  protectManualGrantInPatch,
} from "../supabase/functions/revenuecat-webhook/premium.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const NONE = { ad_free: false, profile_pack: false, host_pack: false };
const ALL = { ad_free: true, profile_pack: true, host_pack: true };
const HOST_GRANT = { host_pack: true, profile_pack: true, ad_free: true };

describe("Droits offerts : calcul", () => {
  it("sans droit offert : les droits des achats seuls", () => {
    assert.deepEqual(applyManualGrant(NONE, null), NONE);
    assert.deepEqual(applyManualGrant({ ad_free: true }, null), { ad_free: true, profile_pack: false, host_pack: false });
  });

  it("Maître offert sans aucun achat : tout", () => {
    assert.deepEqual(applyManualGrant(premiumFlagsFromPurchases([]), HOST_GRANT), ALL);
    assert.deepEqual(applyManualGrant(NONE, { host_pack: true }), ALL);
  });

  it("Signature offerte : Signature + Sans pub, et un Maître acheté reste", () => {
    assert.deepEqual(applyManualGrant(NONE, { profile_pack: true }), { ad_free: true, profile_pack: true, host_pack: false });
    assert.deepEqual(applyManualGrant({ host_pack: true, profile_pack: true, ad_free: true }, { profile_pack: true }), ALL);
  });

  it("repli : un remboursement ne retire jamais un droit offert", () => {
    const refundPatch = { host_pack: false, profile_pack: false, ad_free: false };
    assert.deepEqual(protectManualGrantInPatch(refundPatch, HOST_GRANT), ALL);
    assert.deepEqual(protectManualGrantInPatch({ ad_free: false }, { profile_pack: true }), { ad_free: true });
    assert.deepEqual(protectManualGrantInPatch(refundPatch, null), refundPatch);
  });
});

describe("Droits offerts : webhook", () => {
  const src = read("supabase/functions/revenuecat-webhook/index.ts");

  it("relecture RevenueCat : droits des achats + droits offerts", () => {
    assert.match(src, /const manual = await readManualGrant\(supabase, userId\);/);
    assert.match(src, /applyManualGrant\(\s*premiumFlagsFromPurchases\(fetched\.purchases/);
  });

  it("repli : patch protégé avant écriture", () => {
    const fallback = src.slice(src.indexOf("--- Repli"));
    assert.ok(fallback.indexOf("protectManualGrantInPatch(rawPatch, manual.grant)") < fallback.indexOf("writeFlags("));
  });

  it("lecture impossible : 500 plutôt que de risquer de retirer un droit offert", () => {
    assert.match(src, /if \(!manual\.ok\) return json\(500, \{ ok: false, reason: "manual_grant_read" \}\);/);
  });
});

describe("Droits offerts : migration", () => {
  const sql = read("supabase/feature-premium-manual-grants.sql");

  it("table réservée au serveur", () => {
    assert.match(sql, /create table if not exists public\.premium_manual_grants/);
    assert.match(sql, /references auth\.users\(id\) on delete cascade/);
    assert.match(sql, /alter table public\.premium_manual_grants enable row level security;/);
    for (const role of ["public", "anon", "authenticated"]) {
      assert.match(sql, new RegExp(`revoke all on table public\\.premium_manual_grants from ${role};`));
    }
  });

  it("ajout / retrait par e-mail, réservés à l'éditeur SQL", () => {
    assert.match(sql, /function public\.grant_premium_by_email\(/);
    assert.match(sql, /function public\.revoke_premium_by_email\(/);
    for (const fn of ["grant_premium_by_email\\(text, text, text\\)", "revoke_premium_by_email\\(text\\)"]) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from authenticated;`));
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from anon;`));
    }
  });

  it("l'ajout n'est donné qu'à un vrai compte, et ne retire rien", () => {
    assert.match(sql, /coalesce\(u\.is_anonymous, false\) is false/);
    assert.match(sql, /set host_pack = host_pack or v_host,/);
  });
});
