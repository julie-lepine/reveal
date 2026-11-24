/**
 * Audit achats (tmp/audit-achats-premium.md) — le webhook relit les achats réels
 * de chaque compte chez RevenueCat (API v2) au lieu de déduire les droits de
 * l'événement.
 *  n°1  transfert d'achat entre comptes, événements dans le désordre ;
 *  n°2  profil absent → 500 (RevenueCat réessaie) ;
 *  n°3  secret en en-tête seulement, réponse 401 muette ;
 *  n°4  mise à niveau sans base (rembourser Signature retire le Maître à 3 €) ;
 *  n°5  suppression de compte : client RevenueCat supprimé (en option).
 * Format des achats : celui renvoyé par l'API v2 (vu sur le projet le 2026-11-22).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RC_PRODUCT_SKUS,
  fetchCustomerPurchases,
  premiumFlagsFromPurchases,
  skuOfPurchase,
  targetUserIdsFromEvent,
} from "../supabase/functions/revenuecat-webhook/premium.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const PRODUCT = {
  adfree: "prodcfede78f5a",
  profile: "prod252c4f6aac",
  profileUpgrade: "prod3b435a254f",
  host: "prod6d9b23e0bf",
  hostFromProfile: "prod6ce576b7bb",
  hostFromAdFree: "prod8255b4eb88",
};

function buy(productId, { status = "owned", environment = "production" } = {}) {
  return { object: "purchase", product_id: productId, status, environment, entitlements: { items: [] } };
}

const NONE = { ad_free: false, profile_pack: false, host_pack: false };
const ALL = { ad_free: true, profile_pack: true, host_pack: true };

describe("Droits d'après les achats réels", () => {
  it("chaque produit du projet est connu", () => {
    assert.equal(Object.keys(RC_PRODUCT_SKUS).length, 13);
    assert.equal(skuOfPurchase(buy(PRODUCT.hostFromProfile)), "reveal_host_upgrade_profile");
  });

  it("achats simples", () => {
    assert.deepEqual(premiumFlagsFromPurchases([]), NONE);
    assert.deepEqual(premiumFlagsFromPurchases([buy(PRODUCT.adfree)]), {
      ad_free: true,
      profile_pack: false,
      host_pack: false,
    });
    assert.deepEqual(premiumFlagsFromPurchases([buy(PRODUCT.profile)]), {
      ad_free: true,
      profile_pack: true,
      host_pack: false,
    });
    assert.deepEqual(premiumFlagsFromPurchases([buy(PRODUCT.host)]), ALL);
  });

  it("mises à niveau avec leur base : valables", () => {
    assert.deepEqual(
      premiumFlagsFromPurchases([buy(PRODUCT.adfree), buy(PRODUCT.profileUpgrade)]),
      { ad_free: true, profile_pack: true, host_pack: false }
    );
    assert.deepEqual(premiumFlagsFromPurchases([buy(PRODUCT.profile), buy(PRODUCT.hostFromProfile)]), ALL);
    assert.deepEqual(premiumFlagsFromPurchases([buy(PRODUCT.adfree), buy(PRODUCT.hostFromAdFree)]), ALL);
  });

  it("n°4 : Signature remboursée après la mise à niveau Maître → tout est retiré", () => {
    const flags = premiumFlagsFromPurchases([
      buy(PRODUCT.profile, { status: "refunded" }),
      buy(PRODUCT.hostFromProfile),
    ]);
    assert.deepEqual(flags, NONE);
  });

  it("n°4 : Sans pub remboursé sous une chaîne de mises à niveau → la chaîne tombe", () => {
    const flags = premiumFlagsFromPurchases([
      buy(PRODUCT.adfree, { status: "refunded" }),
      buy(PRODUCT.profileUpgrade),
      buy(PRODUCT.hostFromProfile),
    ]);
    assert.deepEqual(flags, NONE);
  });

  it("remboursement de la mise à niveau seule : la base reste", () => {
    const flags = premiumFlagsFromPurchases([
      buy(PRODUCT.profile),
      buy(PRODUCT.hostFromProfile, { status: "refunded" }),
    ]);
    assert.deepEqual(flags, { ad_free: true, profile_pack: true, host_pack: false });
  });

  it("achats de test : ignorés, sauf compte autorisé", () => {
    const sandbox = [buy(PRODUCT.host, { environment: "sandbox" })];
    assert.deepEqual(premiumFlagsFromPurchases(sandbox, { userId: A }), NONE);
    assert.deepEqual(premiumFlagsFromPurchases(sandbox, { userId: A, sandboxAllowedCsv: `x,${A}` }), ALL);
  });

  it("produit inconnu : on se fie à son droit", () => {
    const unknown = { status: "owned", environment: "production", product_id: "prodNEW", entitlements: { items: [{ lookup_key: "profile" }] } };
    assert.deepEqual(premiumFlagsFromPurchases([unknown]), { ad_free: true, profile_pack: true, host_pack: false });
  });
});

describe("n°1 : comptes touchés par un événement", () => {
  it("achat : l'acheteur", () => {
    assert.deepEqual(targetUserIdsFromEvent({ app_user_id: A }), [A]);
  });

  it("transfert : les deux comptes (l'ancien perd, le nouveau gagne)", () => {
    assert.deepEqual(
      targetUserIdsFromEvent({ type: "TRANSFER", transferred_from: [A, "$RCAnonymousID:x"], transferred_to: [B] }),
      [A, B]
    );
  });

  it("identifiants non Supabase ignorés", () => {
    assert.deepEqual(targetUserIdsFromEvent({ app_user_id: "$RCAnonymousID:abc" }), []);
    assert.deepEqual(targetUserIdsFromEvent({ app_user_id: "pas-un-uuid" }), []);
  });
});

describe("Lecture des achats chez RevenueCat", () => {
  it("suit les pages et envoie la clé en en-tête", async () => {
    const calls = [];
    const pages = [
      { items: [buy(PRODUCT.adfree)], next_page: "/v2/projects/p/customers/c/purchases?starting_after=x" },
      { items: [buy(PRODUCT.profileUpgrade)], next_page: null },
    ];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, auth: opts.headers.Authorization });
      return { ok: true, json: async () => pages[calls.length - 1] };
    };
    const out = await fetchCustomerPurchases({ projectId: "p", apiKey: "sk_x", customerId: A, fetchImpl });
    assert.equal(out.ok, true);
    assert.equal(out.purchases.length, 2);
    assert.equal(calls[0].auth, "Bearer sk_x");
    assert.match(calls[1].url, /^https:\/\/api\.revenuecat\.com\/v2\/projects\/p\/customers\/c\/purchases\?starting_after=x$/);
  });

  it("erreur RevenueCat : signalée, pour ne rien changer en base", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const out = await fetchCustomerPurchases({ projectId: "p", apiKey: "k", customerId: A, fetchImpl });
    assert.deepEqual(out, { ok: false, status: 404 });
  });
});

describe("Webhook (fichier déployé)", () => {
  const src = read("supabase/functions/revenuecat-webhook/index.ts");

  it("n°1 : relit les achats de chaque compte touché, et réécrit ses droits", () => {
    assert.match(src, /const userIds = targetUserIdsFromEvent\(event\);/);
    assert.match(src, /fetchCustomerPurchases\(\{/);
    assert.match(src, /premiumFlagsFromPurchases\(fetched\.purchases/);
    assert.match(src, /return json\(500, \{ ok: false, reason: "revenuecat_read" \}\);/);
  });

  it("repli sur l'ancien calcul tant que la clé RevenueCat n'est pas configurée", () => {
    assert.match(src, /if \(rcKey && rcProject\) \{/);
    assert.match(src, /--- Repli/);
  });

  it("n°2 : profil absent alors qu'il y a un droit à donner → 500", () => {
    const fn = src.slice(src.indexOf("async function writeFlags("));
    // `row` = les droits (+ photo retirée sans Signature ni Maître, audit compte n°2).
    assert.match(fn, /\.update\(row\)\s*\.eq\("id", userId\)\s*\.select\("id"\);/);
    assert.match(fn, /if \(!touched && grantsSomething\) return \{ ok: false, reason: "profile_missing" \};/);
  });

  it("n°3 : secret en en-tête seulement, réponse 401 sans indice", () => {
    assert.doesNotMatch(src, /searchParams/);
    assert.doesNotMatch(src, /want_len|got_len|mismatchHint/);
    assert.match(src, /return json\(401, \{ ok: false \}\);/);
  });
});

describe("n°5 : suppression de compte", () => {
  const src = read("supabase/functions/delete-account/index.ts");

  it("client RevenueCat supprimé, en option, après la suppression du compte", () => {
    assert.match(src, /REVENUECAT_DELETE_ON_ACCOUNT_DELETE/);
    assert.match(src, /method: "DELETE"/);
    assert.ok(src.indexOf("admin.auth.admin.deleteUser") < src.indexOf("await deleteRevenueCatCustomer(user.id)"));
  });

  it("une panne RevenueCat ne bloque pas la suppression du compte", () => {
    const fn = src.slice(src.indexOf("async function deleteRevenueCatCustomer("));
    assert.match(fn, /\} catch \(e\) \{[\s\S]*return "failed";/);
    assert.match(src, /return json\(200, \{ ok: true, avatar, revenuecat \}\);/);
  });
});
