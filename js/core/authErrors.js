/** Messages auth Supabase en français pour l’UI. */
export function formatAuthErrorMessage(message) {
  const raw = String(message || "").trim();
  const m = raw.toLowerCase();

  if (!raw) return "Une erreur est survenue. Réessaie.";

  if (/rate limit|too many requests|email.*limit/i.test(m)) {
    return "Trop de demandes d’emails. Attends quelques minutes avant de réessayer.";
  }
  if (/invalid login credentials|invalid credentials/i.test(m)) {
    return "Email ou mot de passe incorrect.";
  }
  if (/user already registered|already registered|already exists/i.test(m)) {
    return "Un compte existe déjà pour cet email.";
  }
  if (/email not confirmed/i.test(m)) {
    return "Confirme ton email avant de te connecter (vérifie ta boîte mail).";
  }
  if (/password.*at least|weak password/i.test(m)) {
    return "Le mot de passe est trop faible (4 caractères minimum).";
  }
  if (/missing email or phone/i.test(m)) {
    return "Indique ton email pour te connecter.";
  }
  if (/captcha|turnstile|challenge.*failed|verification.*failed|no captcha_token/i.test(m)) {
    return "Vérifie la case anti-robot et réessaie.";
  }

  return raw;
}

export function isAuthCaptchaError(message) {
  return /captcha|turnstile|challenge|verification/i.test(String(message || "").toLowerCase());
}

export function isAuthRateLimitError(message) {
  return /rate limit|too many requests|email.*limit/i.test(String(message || "").toLowerCase());
}
