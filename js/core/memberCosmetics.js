/**
 * Audit carnet et cosmétiques n°1 — emoji et couleur d'un membre du salon.
 * Ces deux valeurs viennent de `lobby_members`, que chaque joueur écrit lui-même :
 * on ne garde qu'un emoji des listes connues et une couleur #hex, sinon le défaut.
 * Le serveur applique la même règle (supabase/fix-member-cosmetics.sql).
 */
import { PROFILE_EMOJI_CHOICES, DEFAULT_PROFILE_EMOJI } from "../../data/profileEmojis.js";
import {
  SIGNATURE_EMOJI_CHOICES,
  normalizeEmojiGrapheme,
} from "../../data/signatureIdentity.js";

export const DEFAULT_MEMBER_COLOR = "#A78BFA";

const KNOWN_EMOJIS = new Map(
  [...PROFILE_EMOJI_CHOICES, ...SIGNATURE_EMOJI_CHOICES].map((e) => [
    normalizeEmojiGrapheme(e),
    e,
  ])
);

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Emoji d'une liste connue (gratuits ou Signature), sinon l'emoji par défaut. */
export function sanitizeMemberEmoji(emoji, fallback = DEFAULT_PROFILE_EMOJI) {
  if (typeof emoji !== "string") return fallback;
  return KNOWN_EMOJIS.get(normalizeEmojiGrapheme(emoji)) || fallback;
}

/** Couleur au format #rgb, #rrggbb ou #rrggbbaa, sinon la couleur par défaut. */
export function sanitizeMemberColor(color, fallback = DEFAULT_MEMBER_COLOR) {
  const raw = typeof color === "string" ? color.trim() : "";
  return HEX_COLOR_RE.test(raw) ? raw : fallback;
}
