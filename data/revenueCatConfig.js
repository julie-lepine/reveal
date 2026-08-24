/**
 * RevenueCat — configuration publique Android uniquement (FEATURE-ADFREE-02A).
 *
 * La clé SDK Android commence par `appl_`. Ce n’est PAS :
 * - la clé API secrète (préfixe sk)
 * - un secret de notification store
 * - le rôle service Supabase
 *
 * Remplacer le placeholder par la clé publique Android du dashboard RevenueCat
 * avant l’étape d’achat (02B). Ne jamais coller de secret ici.
 */
export const REVENUECAT_ANDROID_PUBLIC_SDK_KEY = "appl_REPLACE_ME";

/** Identifiant d’entitlement prévu (pas encore utilisé). */
export const REVENUECAT_ENTITLEMENT_AD_FREE = "ad_free";

/** SKU Play Console prévu (pas encore créé, pas encore acheté). */
export const PLAY_PRODUCT_ID_AD_FREE = "reveal_adfree";
