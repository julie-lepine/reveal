// FEATURE-ADFREE-02B / FEATURE-PROFILE-02B — webhook RevenueCat
// → profiles.ad_free + profiles.profile_pack
// Secrets (Dashboard → Edge Functions → Secrets, jamais dans le repo) :
//   REVENUECAT_WEBHOOK_AUTH  = même chaîne que RevenueCat → Webhooks → Authorization
//                            (mot de passe seul, sans le mot Bearer)
//   SUPABASE_URL             = fourni par la plateforme
//   SUPABASE_SERVICE_ROLE_KEY
//
// Deploy : npx supabase functions deploy revenuecat-webhook --no-verify-jwt
// URL    : https://<project>.supabase.co/functions/v1/revenuecat-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRANT = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "TRANSFER",
  "TEST",
]);

const REVOKE = new Set(["EXPIRATION", "REFUND"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function presentedAuth(req) {
  const header = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const url = new URL(req.url);
  const query = url.searchParams.get("auth") || url.searchParams.get("token") || "";
  return { header, query };
}

function authorizationMatches(presented, secret) {
  const token = stripBearer(presented);
  const expected = stripBearer(secret);
  return Boolean(token && expected && token === expected);
}

function mismatchHint(presented, secret) {
  const got = stripBearer(presented);
  const want = stripBearer(secret);
  if (!want) return { reason: "missing_secret" };
  if (!got) return { reason: "missing_header" };
  return {
    reason: "mismatch",
    got_len: got.length,
    want_len: want.length,
    got_jwt: got.split(".").length === 3,
    got_sk: got.startsWith("sk_"),
  };
}

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

function isProfileUpgradeProduct(event) {
  return skuMatch(eventProductId(event), "reveal_profile_upgrade");
}

function entitlementPatch(type, event) {
  const grant = GRANT.has(type);
  const revoke = REVOKE.has(type);
  if (!grant && !revoke) return null;

  const touchesProfile = eventTouchesProfile(event);
  const touchesAdFree = eventTouchesAdFree(event);
  const patch = {};

  if (touchesProfile) {
    patch.profile_pack = grant;
    if (grant) patch.ad_free = true;
    else if (!isProfileUpgradeProduct(event)) patch.ad_free = false;
  } else if (touchesAdFree || type === "TEST") {
    patch.ad_free = grant;
  }

  return Object.keys(patch).length ? patch : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });

  const expected = Deno.env.get("REVENUECAT_WEBHOOK_AUTH") || "";
  const { header, query } = presentedAuth(req);
  if (
    !authorizationMatches(header, expected) &&
    !authorizationMatches(query, expected)
  ) {
    return json(401, { ok: false, ...mismatchHint(header || query, expected) });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false });
  }

  const event = payload?.event || payload;
  const type = String(event?.type || "");
  const userId = String(event?.app_user_id || "");

  if (!UUID_RE.test(userId) || userId.startsWith("$RC")) {
    return json(200, { ok: true, skipped: "app_user_id" });
  }

  if (!eventTouchesAdFree(event) && !eventTouchesProfile(event) && type !== "TEST") {
    return json(200, { ok: true, skipped: "product" });
  }

  const patch = entitlementPatch(type, event);
  if (!patch) return json(200, { ok: true, skipped: type });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return json(500, { ok: false });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId);

  if (error) return json(500, { ok: false, error: error.message });
  return json(200, { ok: true, ...patch });
});
