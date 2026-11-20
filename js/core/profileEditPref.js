/**
 * Menu > Profil : mémorise si « Modifier mon profil » est ouvert ou replié
 * (préférence locale à l'appareil, sans compte ni serveur).
 */
export const PROFILE_EDIT_OPEN_KEY = "reveal-profile-edit-open";

/** @returns {boolean|null} null = jamais choisi (défaut de l'écran). */
export function readProfileEditOpen(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PROFILE_EDIT_OPEN_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* stockage indisponible : défaut de l'écran */
  }
  return null;
}

export function writeProfileEditOpen(open, storage = globalThis.localStorage) {
  try {
    storage?.setItem(PROFILE_EDIT_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* stockage indisponible : on ne mémorise pas */
  }
}

/** Ouvert si choisi ainsi, sinon défaut : ouvert pour Signature, replié sinon. */
export function profileEditInitiallyOpen(unlocked, storage) {
  const saved = readProfileEditOpen(storage);
  return saved == null ? Boolean(unlocked) : saved;
}
