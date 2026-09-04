/** Emojis proposés pour le profil joueur (gratuit). */
export const PROFILE_EMOJI_CHOICES = [
  "😀", "🤩", "🥳", "🎭", "🎮", "🃏",
  "👤", "🍺", "⚽", "⭐", "🎲", "🦊",
  "🐱", "🐶", "🦁", "🍕", "🎸", "🕵️",
];

export const DEFAULT_PROFILE_EMOJI = "👤";

/** Emoji par défaut à la connexion invité (historique). */
export const DEFAULT_GUEST_EMOJI = "🎭";

/**
 * Valide un emoji de profil invité : liste connue, sinon défaut.
 * Accepte jusqu’à 2 graphemes (aligné sur setLocalEmoji).
 */
export function normalizeGuestEmoji(emoji) {
  const raw = String(emoji ?? "").trim();
  if (!raw) return DEFAULT_GUEST_EMOJI;
  const graphemes = [...raw];
  const chosen = graphemes.slice(0, 2).join("");
  if (PROFILE_EMOJI_CHOICES.includes(chosen)) return chosen;
  const first = graphemes[0];
  if (PROFILE_EMOJI_CHOICES.includes(first)) return first;
  return DEFAULT_GUEST_EMOJI;
}
