/**
 * Identité Signature : palette fermée + emojis extra.
 * Les emojis de profileEmojis.js restent gratuits.
 */

import { PROFILE_EMOJI_CHOICES } from "./profileEmojis.js";

/** ids stables persistés en base (pas un hex libre). */
export const SIGNATURE_NAME_COLORS = Object.freeze([
  { id: "gold", hex: "#F5D76E", label: "Or" },
  { id: "rose", hex: "#F472B6", label: "Rose" },
  { id: "violet", hex: "#C4B5FD", label: "Violet" },
  { id: "cyan", hex: "#67E8F9", label: "Cyan" },
  { id: "lime", hex: "#86EFAC", label: "Vert" },
  { id: "amber", hex: "#FBBF24", label: "Ambre" },
  { id: "coral", hex: "#FB7185", label: "Corail" },
  { id: "ice", hex: "#E0F2FE", label: "Glace" },
]);

export const SIGNATURE_NAME_COLOR_IDS = Object.freeze(
  SIGNATURE_NAME_COLORS.map((c) => c.id)
);

export const SIGNATURE_EMOJI_CHOICES = Object.freeze([
  "👑",
  "🦄",
  "🐉",
  "🦋",
  "🌙",
  "⚡",
  "🥂",
  "🏆",
  "💫",
  "🧿",
  "🖤",
  "🩷",
  "😈",
  "👻",
  "🔥",
  "🐸",
  "💎",
  "🌈",
  "😎",
  "💜",
  "🌟",
  "🎯",
  "🚀",
  "🎈",
]);

export function normalizeEmojiGrapheme(emoji) {
  const raw = String(emoji ?? "").trim().replace(/\uFE0F/g, "");
  if (!raw) return "";
  return [...raw].slice(0, 2).join("");
}

export function emojiFromUtf8Hex(hex) {
  const h = String(hex || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (!h || h.length % 2) return "";
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function utf8HexFromEmoji(emoji) {
  const chosen = normalizeEmojiGrapheme(emoji);
  if (!chosen || typeof TextEncoder === "undefined") return "";
  return Array.from(new TextEncoder().encode(chosen))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isFreeProfileEmoji(emoji) {
  const chosen = normalizeEmojiGrapheme(emoji);
  return Boolean(
    chosen && PROFILE_EMOJI_CHOICES.some((e) => normalizeEmojiGrapheme(e) === chosen)
  );
}

export function isSignatureProfileEmoji(emoji) {
  const chosen = normalizeEmojiGrapheme(emoji);
  return Boolean(
    chosen && SIGNATURE_EMOJI_CHOICES.some((e) => normalizeEmojiGrapheme(e) === chosen)
  );
}

export function canUseProfileEmoji(emoji, { profilePack = false, isGuest = false } = {}) {
  if (isFreeProfileEmoji(emoji)) return true;
  if (isGuest) return false;
  return profilePack === true && isSignatureProfileEmoji(emoji);
}

export function isAllowedNameColorId(id) {
  return SIGNATURE_NAME_COLOR_IDS.includes(String(id || ""));
}

export function nameColorHexFromId(id) {
  if (!isAllowedNameColorId(id)) return null;
  return SIGNATURE_NAME_COLORS.find((c) => c.id === id)?.hex || null;
}

/**
 * Couleur de pseudo à afficher. Sans Signature (ou id hors palette) → null.
 * @param {{ signature?: boolean, nameColor?: string|null }} p
 */
export function resolvedNameColorHex(p) {
  if (!p?.signature) return null;
  return nameColorHexFromId(p.nameColor);
}
