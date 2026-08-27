/**
 * Identité live (pseudo / emoji) : le fallback « Joueur » / 👤 n’est pas
 * un vrai choix de profil. On le traite comme une absence pour relire
 * le pseudo d’inscription (`user_metadata.display_name`) ou un nom local.
 */

export const PLACEHOLDER_DISPLAY_NAME = "Joueur";
export const PLACEHOLDER_EMOJI = "👤";

export function isPlaceholderDisplayName(name) {
  const trimmed = String(name || "").trim();
  return !trimmed || trimmed === PLACEHOLDER_DISPLAY_NAME;
}

export function isPlaceholderEmoji(emoji) {
  const trimmed = String(emoji || "").trim();
  return !trimmed || trimmed === PLACEHOLDER_EMOJI;
}

export function emailLocalPart(email) {
  const local = String(email || "").split("@")[0].trim();
  return local.length >= 2 ? local : "";
}

/**
 * @param {{
 *   lockedGuestName?: string|null,
 *   profileName?: string|null,
 *   metadataName?: string|null,
 *   email?: string|null,
 *   localName?: string|null,
 * }} parts
 */
export function resolveLiveDisplayName(parts = {}) {
  const candidates = [
    parts.lockedGuestName,
    isPlaceholderDisplayName(parts.profileName) ? "" : parts.profileName,
    parts.metadataName,
    emailLocalPart(parts.email),
    isPlaceholderDisplayName(parts.localName) ? "" : parts.localName,
  ];
  for (const raw of candidates) {
    const name = String(raw || "").trim();
    if (name.length >= 2) return name.slice(0, 24);
  }
  return PLACEHOLDER_DISPLAY_NAME;
}

/**
 * @param {{
 *   lockedGuestEmoji?: string|null,
 *   profileEmoji?: string|null,
 *   metadataEmoji?: string|null,
 *   localEmoji?: string|null,
 * }} parts
 */
export function resolveLiveEmoji(parts = {}) {
  const candidates = [
    parts.lockedGuestEmoji,
    isPlaceholderEmoji(parts.profileEmoji) ? "" : parts.profileEmoji,
    parts.metadataEmoji,
    isPlaceholderEmoji(parts.localEmoji) ? "" : parts.localEmoji,
  ];
  for (const raw of candidates) {
    const emoji = String(raw || "").trim();
    if (emoji) return emoji;
  }
  return PLACEHOLDER_EMOJI;
}

export function registeredProfileNeedsHeal(profile, displayName, emoji) {
  if (!profile) return !isPlaceholderDisplayName(displayName);
  const nameBetter =
    isPlaceholderDisplayName(profile.display_name) &&
    !isPlaceholderDisplayName(displayName);
  const emojiBetter =
    isPlaceholderEmoji(profile.emoji) && !isPlaceholderEmoji(emoji);
  return nameBetter || emojiBetter;
}
