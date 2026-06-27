const STORAGE_KEY = "reveal-password-reset-until";
const DEFAULT_COOLDOWN_MS = 60_000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

export function getPasswordResetCooldownRemainingMs() {
  let until = 0;
  try {
    until = Number(localStorage.getItem(STORAGE_KEY) || 0);
  } catch {
    return 0;
  }
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function markPasswordResetSent(durationMs = DEFAULT_COOLDOWN_MS) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + durationMs));
  } catch {
    /* quota plein / storage indisponible */
  }
}

export function markPasswordResetRateLimited() {
  markPasswordResetSent(RATE_LIMIT_COOLDOWN_MS);
}

export function passwordResetCooldownMessage(remainingMs = getPasswordResetCooldownRemainingMs()) {
  const sec = Math.ceil(remainingMs / 1000);
  if (sec >= 120) {
    const min = Math.ceil(sec / 60);
    return `Trop de demandes. Réessaie dans ${min} minute${min > 1 ? "s" : ""}.`;
  }
  return `Trop de demandes. Réessaie dans ${sec} seconde${sec > 1 ? "s" : ""}.`;
}
