/**
 * RevenueCat — clés SDK publiques (client). Ce n’est PAS :
 * - la clé API secrète (préfixe `sk_`)
 * - un secret de notification store
 * - le rôle service Supabase
 *
 * Android = `goog_…` (Play). iOS = `appl_…` (App Store).
 * iOS : clé publique SDK (pas le `.p8`, pas `sk_`).
 */
export const REVENUECAT_ANDROID_PUBLIC_SDK_KEY = "goog_fAWUHQzLQozCmAoNwnJURxbeJgR";

export const REVENUECAT_IOS_PUBLIC_SDK_KEY = "appl_bpgdhybGDtsIWmmFNqlRlnJxLgV";

export const REVENUECAT_ENTITLEMENT_AD_FREE = "ad_free";

export const REVENUECAT_ENTITLEMENT_PROFILE = "profile";

/** SKU Play Console et App Store. */
export const PLAY_PRODUCT_ID_AD_FREE = "reveal_adfree";

export const PLAY_PRODUCT_ID_PROFILE = "reveal_profile";

export const PLAY_PRODUCT_ID_PROFILE_UPGRADE = "reveal_profile_upgrade";
