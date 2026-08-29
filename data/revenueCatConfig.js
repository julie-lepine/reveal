/**
 * RevenueCat — clés SDK publiques (client). Ce n’est PAS :
 * - la clé API secrète (préfixe `sk_`)
 * - un secret de notification store
 * - le rôle service Supabase
 *
 * Android = `goog_…` (Play). iOS = `appl_…` (App Store).
 * iOS : coller `appl_…` avant l’Archive prod (Paid Apps Actif + IAP `reveal_adfree`).
 */
export const REVENUECAT_ANDROID_PUBLIC_SDK_KEY = "goog_fAWUHQzLQozCmAoNwnJURxbeJgR";

export const REVENUECAT_IOS_PUBLIC_SDK_KEY = "appl_REPLACE_ME";

/** Identifiant d’entitlement prévu (pas encore utilisé). */
export const REVENUECAT_ENTITLEMENT_AD_FREE = "ad_free";

/** SKU Play Console et App Store. */
export const PLAY_PRODUCT_ID_AD_FREE = "reveal_adfree";
