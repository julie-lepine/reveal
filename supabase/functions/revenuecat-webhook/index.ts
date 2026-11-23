// FEATURE-ADFREE-02B / FEATURE-PROFILE-02B / FEATURE-HOST-02B — webhook RevenueCat
// → profiles.ad_free + profiles.profile_pack + profiles.host_pack
// Secrets (Dashboard → Edge Functions → Secrets, jamais dans le repo) :
//   REVENUECAT_WEBHOOK_AUTH  = même chaîne que RevenueCat → Webhooks → Authorization
//                            (mot de passe seul, sans le mot Bearer). En-tête seulement.
//   SUPABASE_URL             = fourni par la plateforme
//   SUPABASE_SERVICE_ROLE_KEY
//   REVENUECAT_SECRET_API_KEY = clé secrète API v2 RevenueCat (sk_…), droit
//                            « customer_information:purchases:read ». Avec elle, les
//                            droits sont relus chez RevenueCat à chaque événement.
//                            Sans elle : ancien calcul d'après l'événement (repli).
//   REVENUECAT_PROJECT_ID    = identifiant du projet RevenueCat (proj…).
//   REVENUECAT_SANDBOX_ALLOWED_USER_IDS (optionnel) = uids Supabase autorisés à
//                            recevoir un droit depuis un achat de test (sandbox),
//                            séparés par des virgules. Vide = aucun.
//
// Audit achats (tmp/audit-achats-premium.md) : n°1 transfert / désordre (relecture
// RevenueCat), n°2 profil absent (500 pour que RevenueCat réessaie), n°3 réponses
// d'erreur muettes et secret en en-tête seulement, n°3b achats de test, n°4 mise à
// niveau sans base. Droits offerts (table premium_manual_grants, migration
// feature-premium-manual-grants.sql) : ajoutés, jamais retirés.
//
// Deploy : npx supabase functions deploy revenuecat-webhook --no-verify-jwt
// URL    : https://<project>.supabase.co/functions/v1/revenuecat-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyManualGrant,
  fetchCustomerPurchases,
  isIgnoredSandboxEvent,
  isSupabaseUserId,
  premiumFlagsFromPurchases,
  protectManualGrantInPatch,
  targetUserIdsFromEvent,
} from "./premium.js";

const GRANT = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "TRANSFER",
  "RESTORE",
  "TEST",
]);

const REVOKE = new Set(["EXPIRATION", "REFUND"]);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stripBearer(value) {
  let s = String(value || "").trim();
  while (/^Bearer\s+/i.test(s)) s = s.replace(/^Bearer\s+/i, "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function authorizationMatches(presented, secret) {
  const token = stripBearer(presented);
  const expected = stripBearer(secret);
  return Boolean(token && expected && token === expected);
}

// ---------------------------------------------------------------------------
// Repli (sans clé secrète RevenueCat) : droits déduits de l'événement seul.
// ---------------------------------------------------------------------------
function eventProductId(event) {
  return String(event?.product_id || event?.new_product_id || "");
}

function skuMatch(product, sku) {
  return product === sku || product.endsWith(`.${sku}`);
}

function eventTouchesAdFree(event) {
  const ids = event?.entitlement_ids;
  if (Array.isArray(ids) && ids.includes("ad_free")) return true;
  return skuMatch(eventProductId(event), "reveal_adfree");
}

function eventTouchesProfile(event) {
  const ids = event?.entitlement_ids;
  if (Array.isArray(ids) && ids.includes("profile")) return true;
  const product = eventProductId(event);
  return skuMatch(product, "reveal_profile_upgrade") || skuMatch(product, "reveal_profile");
}

function eventTouchesHost(event) {
  const ids = event?.entitlement_ids;
  if (Array.isArray(ids) && ids.includes("host")) return true;
  const product = eventProductId(event);
  return (
    skuMatch(product, "reveal_host_upgrade_profile") ||
    skuMatch(product, "reveal_host_upgrade_adfree") ||
    skuMatch(product, "reveal_host")
  );
}

function isProfileUpgradeProduct(event) {
  return skuMatch(eventProductId(event), "reveal_profile_upgrade");
}

function isHostUpgradeFromProfile(event) {
  return skuMatch(eventProductId(event), "reveal_host_upgrade_profile");
}

function isHostUpgradeFromAdFree(event) {
  return skuMatch(eventProductId(event), "reveal_host_upgrade_adfree");
}

function entitlementPatch(type, event) {
  const grant = GRANT.has(type);
  const revoke = REVOKE.has(type);
  if (!grant && !revoke) return null;

  const touchesHost = eventTouchesHost(event);
  const touchesProfile = eventTouchesProfile(event);
  const touchesAdFree = eventTouchesAdFree(event);
  const patch = {};

  if (touchesHost) {
    patch.host_pack = grant;
    if (grant) {
      patch.profile_pack = true;
      patch.ad_free = true;
    } else if (isHostUpgradeFromProfile(event)) {
      /* garde Signature + Sans pub */
    } else if (isHostUpgradeFromAdFree(event)) {
      patch.profile_pack = false;
    } else {
      patch.profile_pack = false;
      patch.ad_free = false;
    }
  } else if (touchesProfile) {
    patch.profile_pack = grant;
    if (grant) patch.ad_free = true;
    else if (!isProfileUpgradeProduct(event)) patch.ad_free = false;
  } else if (touchesAdFree || type === "TEST") {
    patch.ad_free = grant;
  }

  return Object.keys(patch).length ? patch : null;
}

/**
 * Droit offert du compte (table `premium_manual_grants`), ou null. Erreur de
 * lecture : on refuse l'événement (500) plutôt que de risquer de retirer un
 * droit offert ; RevenueCat le renverra.
 */
async function readManualGrant(supabase, userId) {
  const { data, error } = await supabase
    .from("premium_manual_grants")
    .select("host_pack, profile_pack, ad_free")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false };
  return { ok: true, grant: data || null };
}

/**
 * Écrit les droits d'un compte. Ligne `profiles` absente alors qu'il y a un droit
 * à donner : erreur, pour que RevenueCat renvoie l'événement plus tard.
 */
async function writeFlags(supabase, userId, flags) {
  const { data, error } = await supabase
    .from("profiles")
    .update(flags)
    .eq("id", userId)
    .select("id");
  if (error) return { ok: false, reason: "db_error" };
  const touched = Array.isArray(data) && data.length > 0;
  const grantsSomething = Object.values(flags).some((v) => v === true);
  if (!touched && grantsSomething) return { ok: false, reason: "profile_missing" };
  return { ok: true, touched };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });

  // Secret en en-tête seulement (une adresse finit dans les journaux), et aucun
  // indice sur le secret dans la réponse.
  const expected = Deno.env.get("REVENUECAT_WEBHOOK_AUTH") || "";
  const header = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!authorizationMatches(header, expected)) {
    return json(401, { ok: false });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false });
  }

  const event = payload?.event || payload;
  const type = String(event?.type || "");
  const sandboxAllowed = Deno.env.get("REVENUECAT_SANDBOX_ALLOWED_USER_IDS") || "";

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return json(500, { ok: false });
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rcKey = Deno.env.get("REVENUECAT_SECRET_API_KEY") || "";
  const rcProject = Deno.env.get("REVENUECAT_PROJECT_ID") || "";

  // --- Voie principale : droits relus chez RevenueCat pour chaque compte touché.
  if (rcKey && rcProject) {
    const userIds = targetUserIdsFromEvent(event);
    if (!userIds.length) return json(200, { ok: true, skipped: "app_user_id" });
    const results = {};
    for (const userId of userIds) {
      const fetched = await fetchCustomerPurchases({
        projectId: rcProject,
        apiKey: rcKey,
        customerId: userId,
      });
      if (!fetched.ok) {
        // Erreur RevenueCat (ou compte inconnu : réglage faux) : rien n'est changé,
        // RevenueCat renverra l'événement.
        console.error("revenuecat-webhook: lecture des achats impossible", fetched.status);
        return json(500, { ok: false, reason: "revenuecat_read" });
      }
      const manual = await readManualGrant(supabase, userId);
      if (!manual.ok) return json(500, { ok: false, reason: "manual_grant_read" });
      // Droits des achats + droits offerts (jamais retirés).
      const flags = applyManualGrant(
        premiumFlagsFromPurchases(fetched.purchases, {
          userId,
          sandboxAllowedCsv: sandboxAllowed,
        }),
        manual.grant
      );
      const written = await writeFlags(supabase, userId, flags);
      if (!written.ok) return json(500, { ok: false, reason: written.reason });
      results[userId] = flags;
    }
    return json(200, { ok: true, mode: "revenuecat", accounts: Object.keys(results).length });
  }

  // --- Repli (clé RevenueCat pas encore configurée) : ancien calcul.
  const userId = String(event?.app_user_id || "");
  if (!isSupabaseUserId(userId)) {
    return json(200, { ok: true, skipped: "app_user_id" });
  }
  if (isIgnoredSandboxEvent(event, userId, sandboxAllowed)) {
    return json(200, { ok: true, skipped: "sandbox" });
  }
  if (
    !eventTouchesAdFree(event) &&
    !eventTouchesProfile(event) &&
    !eventTouchesHost(event) &&
    type !== "TEST"
  ) {
    return json(200, { ok: true, skipped: "product" });
  }
  const rawPatch = entitlementPatch(type, event);
  if (!rawPatch) return json(200, { ok: true, skipped: type });
  const manual = await readManualGrant(supabase, userId);
  if (!manual.ok) return json(500, { ok: false, reason: "manual_grant_read" });
  // Un droit offert n'est jamais retiré par un remboursement.
  const patch = protectManualGrantInPatch(rawPatch, manual.grant);
  const written = await writeFlags(supabase, userId, patch);
  if (!written.ok) return json(500, { ok: false, reason: written.reason });
  return json(200, { ok: true, mode: "event", ...patch });
});
