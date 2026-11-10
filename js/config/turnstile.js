/**
 * Sitekey hCaptcha (publique). Secret = Supabase → Attack Protection uniquement.
 * Captcha DÉSACTIVÉ (nov. 2026) : clé vide => isTurnstileRequired() === false, aucun widget.
 * Pour le réactiver : remettre la sitekey ET réactiver le captcha dans Supabase.
 * Ancienne sitekey : 9a6c8954-2a54-487e-a0ea-ca8e7cc4bdf4
 */
export const HCAPTCHA_SITE_KEY = "";

/** @deprecated Utiliser HCAPTCHA_SITE_KEY */
export const TURNSTILE_SITE_KEY = HCAPTCHA_SITE_KEY;
