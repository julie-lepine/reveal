/** Keep in sync with supabase/functions/revenuecat-webhook/index.ts (deploy = ce fichier hors du dossier de la function). */

export const GRANT = new Set([
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

export const REVOKE = new Set(["EXPIRATION", "REFUND"]);

function eventProductId(event) {
  return String(event?.product_id || event?.new_product_id || "");
}

function skuMatch(product, sku) {
  return product === sku || product.endsWith(`.${sku}`);
}

export function eventTouchesAdFree(event) {
  const ids = event?.entitlement_ids;
  if (Array.isArray(ids) && ids.includes("ad_free")) return true;
  return skuMatch(eventProductId(event), "reveal_adfree");
}

export function eventTouchesProfile(event) {
  const ids = event?.entitlement_ids;
  if (Array.isArray(ids) && ids.includes("profile")) return true;
  const product = eventProductId(event);
  return skuMatch(product, "reveal_profile_upgrade") || skuMatch(product, "reveal_profile");
}

export function eventTouchesHost(event) {
  const ids = event?.entitlement_ids;
  if (Array.isArray(ids) && ids.includes("host")) return true;
  const product = eventProductId(event);
  return (
    skuMatch(product, "reveal_host_upgrade_profile") ||
    skuMatch(product, "reveal_host_upgrade_adfree") ||
    skuMatch(product, "reveal_host")
  );
}

export function isProfileUpgradeProduct(event) {
  return skuMatch(eventProductId(event), "reveal_profile_upgrade");
}

export function isHostUpgradeFromProfile(event) {
  return skuMatch(eventProductId(event), "reveal_host_upgrade_profile");
}

export function isHostUpgradeFromAdFree(event) {
  return skuMatch(eventProductId(event), "reveal_host_upgrade_adfree");
}

/** Patch `profiles` pour un event RC. `null` = ignorer le type. */
export function entitlementPatch(type, event) {
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
