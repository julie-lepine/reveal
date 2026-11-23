/**
 * Droits premium déduits des achats réels du compte chez RevenueCat (API v2).
 * Module sans dépendance Deno : importé par index.ts et par les tests Node.
 *
 * Audit achats (tmp/audit-achats-premium.md) :
 *  n°1  achat transféré vers un autre compte, événements dans le désordre :
 *       le webhook relit les achats de chaque compte concerné au lieu de
 *       déduire les droits de l'événement ;
 *  n°3b achats de test (sandbox) ignorés, sauf comptes autorisés ;
 *  n°4  une mise à niveau n'est valable que si sa base est encore possédée
 *       (rembourser Signature retire aussi le Maître acheté 3 € par-dessus).
 */

/** Identifiant produit RevenueCat → référence magasin (Play, App Store, Test Store). */
export const RC_PRODUCT_SKUS = Object.freeze({
  prod78814402d5: "reveal_adfree", // Test Store « lifetime » (rattaché à ad_free)
  prodcfede78f5a: "reveal_adfree",
  prodffb71ef6df: "reveal_adfree",
  prod252c4f6aac: "reveal_profile",
  prod7476663716: "reveal_profile",
  prod3b435a254f: "reveal_profile_upgrade",
  prod66497827cf: "reveal_profile_upgrade",
  prod0ec5389eff: "reveal_host",
  prod6d9b23e0bf: "reveal_host",
  prod6ce576b7bb: "reveal_host_upgrade_profile",
  prodb59e335bd6: "reveal_host_upgrade_profile",
  prod8255b4eb88: "reveal_host_upgrade_adfree",
  prod8aabeebe45: "reveal_host_upgrade_adfree",
});

/** Produit inconnu (ajouté plus tard) : on se fie à son droit, comme un achat complet. */
const SKU_BY_ENTITLEMENT = Object.freeze({
  ad_free: "reveal_adfree",
  profile: "reveal_profile",
  host: "reveal_host",
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSupabaseUserId(value) {
  const id = String(value || "").trim();
  return UUID_RE.test(id) && !id.startsWith("$RC");
}

function parseAllowed(allowedCsv) {
  return String(allowedCsv || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Achats de test (sandbox : TestFlight, testeurs Play, Test Store RevenueCat) :
 * gratuits → aucun droit en prod, sauf pour les comptes listés dans
 * REVENUECAT_SANDBOX_ALLOWED_USER_IDS (uids séparés par des virgules).
 */
export function isIgnoredSandboxEvent(event, userId, allowedCsv = "") {
  const env = String(event?.environment || "").trim().toUpperCase();
  if (env !== "SANDBOX") return false;
  return !parseAllowed(allowedCsv).includes(String(userId || "").trim().toLowerCase());
}

/** Comptes touchés par un événement : acheteur, et les deux côtés d'un transfert. */
export function targetUserIdsFromEvent(event) {
  const ids = [
    event?.app_user_id,
    event?.original_app_user_id,
    ...(Array.isArray(event?.transferred_from) ? event.transferred_from : []),
    ...(Array.isArray(event?.transferred_to) ? event.transferred_to : []),
  ]
    .map((id) => String(id || "").trim())
    .filter(isSupabaseUserId);
  return [...new Set(ids)];
}

/** Référence magasin d'un achat (API v2), ou null si rien d'exploitable. */
export function skuOfPurchase(purchase) {
  const known = RC_PRODUCT_SKUS[String(purchase?.product_id || "")];
  if (known) return known;
  const keys = (purchase?.entitlements?.items || [])
    .map((e) => String(e?.lookup_key || ""))
    .filter(Boolean);
  if (keys.includes("host")) return SKU_BY_ENTITLEMENT.host;
  if (keys.includes("profile")) return SKU_BY_ENTITLEMENT.profile;
  if (keys.includes("ad_free")) return SKU_BY_ENTITLEMENT.ad_free;
  return null;
}

/**
 * Droits à écrire dans `profiles`, d'après les achats (API v2 « purchases »).
 * Un achat compte s'il est possédé (pas remboursé) et réel, ou de test pour un
 * compte autorisé. Une mise à niveau ne compte que si sa base compte.
 */
export function premiumFlagsFromPurchases(purchases = [], { userId = "", sandboxAllowedCsv = "" } = {}) {
  const sandboxOk = parseAllowed(sandboxAllowedCsv).includes(
    String(userId || "").trim().toLowerCase()
  );
  const owned = new Set();
  for (const purchase of Array.isArray(purchases) ? purchases : []) {
    if (String(purchase?.status || "") !== "owned") continue;
    const env = String(purchase?.environment || "").toLowerCase();
    if (env === "sandbox" && !sandboxOk) continue;
    const sku = skuOfPurchase(purchase);
    if (sku) owned.add(sku);
  }
  const adFreeBase = owned.has("reveal_adfree");
  const profileBase =
    owned.has("reveal_profile") || (owned.has("reveal_profile_upgrade") && adFreeBase);
  const host =
    owned.has("reveal_host") ||
    (owned.has("reveal_host_upgrade_profile") && profileBase) ||
    (owned.has("reveal_host_upgrade_adfree") && adFreeBase);
  const profile = profileBase || host;
  const adFree = adFreeBase || profile;
  return { ad_free: adFree, profile_pack: profile, host_pack: host };
}

/**
 * Droits offerts (table `premium_manual_grants`) : ajoutés aux droits des achats,
 * jamais retirés par le webhook. Maître inclut Signature et Sans pub ; Signature
 * inclut Sans pub.
 */
export function applyManualGrant(flags, grant) {
  const base = {
    ad_free: flags?.ad_free === true,
    profile_pack: flags?.profile_pack === true,
    host_pack: flags?.host_pack === true,
  };
  if (!grant) return base;
  const host = base.host_pack || grant.host_pack === true;
  const profile = base.profile_pack || grant.profile_pack === true || host;
  const adFree = base.ad_free || grant.ad_free === true || profile;
  return { ad_free: adFree, profile_pack: profile, host_pack: host };
}

/**
 * Repli (patch partiel déduit d'un événement) : un droit offert n'est jamais
 * passé à faux ; les autres champs du patch ne changent pas.
 */
export function protectManualGrantInPatch(patch, grant) {
  if (!patch || !grant) return patch;
  const granted = applyManualGrant({}, grant);
  const out = { ...patch };
  for (const key of Object.keys(out)) {
    if (out[key] === false && granted[key] === true) out[key] = true;
  }
  return out;
}

/**
 * Lit tous les achats d'un compte (API v2, pages suivies). `fetchImpl` injectable
 * pour les tests. Renvoie { ok: true, purchases } ou { ok: false, status }.
 */
export async function fetchCustomerPurchases({
  projectId,
  apiKey,
  customerId,
  fetchImpl = fetch,
  maxPages = 5,
}) {
  const purchases = [];
  let url =
    `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}` +
    `/customers/${encodeURIComponent(customerId)}/purchases?limit=100`;
  for (let page = 0; page < maxPages && url; page += 1) {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    purchases.push(...(Array.isArray(body?.items) ? body.items : []));
    const next = body?.next_page;
    url = next ? (String(next).startsWith("http") ? next : `https://api.revenuecat.com${next}`) : null;
  }
  return { ok: true, purchases };
}
