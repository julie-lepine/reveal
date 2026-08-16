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

const SYNC_NETWORK_ERROR_RE =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|net::err|err_internet_disconnected|err_network_changed/;

export function isSyncNetworkError(message) {
  return SYNC_NETWORK_ERROR_RE.test(String(message || "").toLowerCase());
}

const DRAWIT_PLAYER_MESSAGES = {
  DRAWIT_EMPTY_GUESS: "Entre un mot avec des lettres ou des chiffres.",
  DRAWIT_GUESS_TOO_LONG: "Ce mot est trop long.",
  DRAWIT_DRAWER: "Le dessinateur ne peut pas proposer.",
  DRAWIT_ALREADY_FOUND: "Tu as déjà trouvé ce mot.",
  DRAWIT_EXPIRED: "Trop tard, le temps est écoulé.",
  DRAWIT_NOT_DRAWING: "Ce n'est plus le moment de proposer.",
};

/** Messages réseau / sync patch en français pour l’UI. */
export function formatSyncErrorMessage(message) {
  const raw = String(message || "").trim();
  if (!raw) return "Impossible de synchroniser.";

  if (isSyncNetworkError(raw)) {
    return "Connexion impossible. Vérifie ton réseau et réessaie.";
  }

  const drawItCode = raw.match(/DRAWIT_[A-Z_]+/)?.[0];
  if (drawItCode) {
    return (
      DRAWIT_PLAYER_MESSAGES[drawItCode] ||
      "Proposition non enregistrée. Réessaie."
    );
  }

  return raw;
}
